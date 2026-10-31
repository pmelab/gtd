import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { resolveFlags, type FlagDeclaration } from "../../src/flags/index.ts"
import {
  TASKS,
  VITEST_TASKS,
  failureSignature,
  flagValue,
  gateFor,
  runOptions,
  planStates,
  runStates,
  spawnVp,
  vpArgv,
  type RunTasks,
  type TurboRun,
  type TestState,
} from "../../scripts/test-states.ts"

const flag = (name: string, kind: FlagDeclaration["kind"] = "release"): FlagDeclaration => ({
  name,
  owner: "test",
  expiry: "2099-01-01",
  kind,
})

const stateOf = (label: string): TestState => ({
  label,
  tasks: label === "defaults" ? TASKS : [`test:${label}`],
  env: {},
})

const stub = (runs: readonly (number | null | TurboRun)[]) => {
  const calls: {
    tasks: readonly string[]
    env: Readonly<Record<string, string | undefined>>
  }[] = []
  const run: RunTasks = (tasks, env) => {
    calls.push({ tasks, env })
    const r = runs[calls.length - 1]!
    return typeof r === "object" && r !== null ? r : { code: r, stdout: "" }
  }
  return { run, calls }
}

const flagVars = (s: TestState) =>
  Object.fromEntries(Object.entries(s.env).filter(([k]) => k.startsWith("GTD_FLAG_")))

describe("planStates", () => {
  it("plans exactly one defaults state for an empty registry", () => {
    const states = planStates([], {})
    expect(states).toHaveLength(1)
    expect(states[0]!.label).toBe("defaults")
    expect(states[0]!.tasks).toEqual(TASKS)
  })

  it("ignores ops and experiment flags and leaves them unset", () => {
    const states = planStates([flag("a", "ops"), flag("b", "experiment")], {
      GTD_FLAG_A: "1",
    })
    expect(states).toHaveLength(1)
    expect(flagVars(states[0]!)).toEqual({})
  })

  it("pins a default-off release flag to 0 in defaults and 1 in its own state", () => {
    const states = planStates([flag("alpha")], {})
    expect(states.map((s) => s.label)).toEqual(["defaults", "alpha on"])
    expect(states[0]!.tasks).toEqual(TASKS)
    expect(flagVars(states[0]!)).toEqual({ GTD_FLAG_ALPHA: "0" })
    expect(states[1]!.tasks).toEqual(VITEST_TASKS)
    expect(flagVars(states[1]!)).toEqual({ GTD_FLAG_ALPHA: "1" })
  })

  it("pins a default-on release flag to 1 in defaults and 0 in its off state", () => {
    const states = planStates([{ ...flag("alpha"), defaultOn: true }], {})
    expect(states.map((s) => s.label)).toEqual(["defaults", "alpha off"])
    expect(flagVars(states[0]!)).toEqual({ GTD_FLAG_ALPHA: "1" })
    expect(flagVars(states[1]!)).toEqual({ GTD_FLAG_ALPHA: "0" })
    expect(states[1]!.tasks).toEqual(VITEST_TASKS)
  })

  it("flips one flag per state and pins the others at their defaults", () => {
    const states = planStates([flag("alpha"), { ...flag("beta"), defaultOn: true }], {})
    expect(states.map((s) => s.label)).toEqual(["defaults", "alpha on", "beta off"])
    expect(flagVars(states[0]!)).toEqual({ GTD_FLAG_ALPHA: "0", GTD_FLAG_BETA: "1" })
    expect(flagVars(states[1]!)).toEqual({ GTD_FLAG_ALPHA: "1", GTD_FLAG_BETA: "1" })
    expect(flagVars(states[2]!)).toEqual({ GTD_FLAG_ALPHA: "0", GTD_FLAG_BETA: "0" })
  })

  it("strips every inherited GTD_FLAG_* and keeps other variables", () => {
    const inherited = { GTD_FLAG_ALPHA: "1", GTD_FLAG_OTHER: "true", PATH: "/bin" }
    const states = planStates([flag("alpha"), flag("beta")], inherited)
    for (const s of states) {
      expect(s.env["GTD_FLAG_OTHER"]).toBeUndefined()
      expect(s.env["PATH"]).toBe("/bin")
    }
    expect(states[0]!.env["GTD_FLAG_ALPHA"]).toBe("0")
    expect(states[2]!.env["GTD_FLAG_ALPHA"]).toBe("0")
    expect(states[1]!.env["GTD_FLAG_ALPHA"]).toBe("1")
  })
})

describe("planStates and resolveFlags agree on the variable name", () => {
  it("each state's label matches what resolveFlags reads from its env", () => {
    const registry = [flag("alpha"), { ...flag("kebab-Case"), defaultOn: true }] as const
    for (const state of planStates(registry, {})) {
      const resolved = resolveFlags(state.env, registry)
      const flipped = registry.filter((f) => resolved[f.name] !== (f.defaultOn ?? false))
      const expected = flipped.map((f) => `${f.name} ${resolved[f.name] ? "on" : "off"}`)
      expect(expected.length === 0 ? "defaults" : expected[0]).toBe(state.label)
      expect(flipped.length).toBeLessThanOrEqual(1)
    }
  })
})

describe("spawnVp", () => {
  it("returns code null and reports when vp cannot be spawned", () => {
    const errors: unknown[] = []
    const original = console.error
    console.error = (...a: unknown[]) => errors.push(a[0])
    try {
      expect(spawnVp([], { PATH: "/nonexistent" })).toEqual({ code: null, stdout: "" })
    } finally {
      console.error = original
    }
    expect(String(errors[0])).toContain("cannot run vp")
  })
})

describe("spawnVp against a shim vp", () => {
  const shim = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), "vp-shim-"))
    writeFileSync(join(dir, "vp"), `#!/bin/sh\n${body}\n`)
    chmodSync(join(dir, "vp"), 0o755)
    return dir
  }

  it("delivers forwarded args before the aggregate task name", () => {
    const out = join(mkdtempSync(join(tmpdir(), "vp-argv-")), "argv")
    const dir = shim(`printf '%s\\n' "$@" > "${out}"`)
    expect(spawnVp(TASKS, { PATH: dir }, ["--no-cache"]).code).toBe(0)
    expect(readFileSync(out, "utf8").trim().split("\n")).toEqual([
      "run",
      "--log",
      "labeled",
      "--no-cache",
      "gate",
    ])
  })

  it("captures stdout and the exit code", () => {
    expect(spawnVp(["a"], { PATH: shim("echo hello\nexit 3") })).toEqual({
      code: 3,
      stdout: "hello\n",
    })
  })

  it("captures 2 MiB of stdout without killing vp", () => {
    const dir = shim("i=0\nwhile [ $i -lt 2048 ]; do printf '%01024d' 0; i=$((i+1)); done")
    const r = spawnVp(["a"], { PATH: dir })
    expect(r.code).toBe(0)
    expect(r.stdout).toHaveLength(2 * 1024 * 1024)
  })
})

describe("flagValue", () => {
  it.each([
    [["--log=grouped"], "--log", "grouped"],
    [["--log", "grouped"], "--log", "grouped"],
    [["--no-cache"], "--log", undefined],
    [["--log"], "--log", ""],
    [["--", "--log=grouped"], "--log", undefined],
  ])("%j reads %s as %j", (args, flag, expected) => expect(flagValue(args, flag)).toBe(expected))
})

describe("runOptions", () => {
  it.each([
    [[], { full: false, collapse: true }],
    [["--full"], { full: true, collapse: false }],
    [["--log", "labeled"], { full: false, collapse: true }],
    [["--log=grouped"], { full: false, collapse: false }],
    [["--log", "interleaved"], { full: false, collapse: false }],
  ])("%j gives %j", (args, expected) => expect(runOptions(args)).toEqual(expected))
})

describe("gateFor", () => {
  it("names the aggregate task for each planned task set", () => {
    expect(gateFor(TASKS)).toBe("gate")
    expect(gateFor(VITEST_TASKS)).toBe("gate:tests")
  })
})

describe("vpArgv", () => {
  it.each([
    [["--no-cache"], ["run", "--log", "labeled", "--no-cache", "gate"]],
    [["--log=grouped"], ["run", "--log=grouped", "gate"]],
    [["--full"], ["run", "--log", "labeled", "gate"]],
  ])("%j", (args, expected) => expect(vpArgv(TASKS, args)).toEqual(expected))
})

describe("failureSignature against real vp", () => {
  const realRun = (command: string) => {
    const dir = mkdtempSync(join(tmpdir(), "vp-real-"))
    symlinkSync(
      fileURLToPath(new URL("../../node_modules", import.meta.url)),
      join(dir, "node_modules"),
    )
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "scratch", private: true }))
    writeFileSync(
      join(dir, "vite.config.ts"),
      `export default { run: { tasks: { boom: { command: ${JSON.stringify(command)}, cache: false } } } }\n`,
    )
    const vp = fileURLToPath(new URL("../../node_modules/.bin/vp", import.meta.url))
    return () =>
      spawnSync(vp, ["run", "--log", "labeled", "boom"], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, GITHUB_ACTIONS: "true" },
      }).stdout
  }

  it("is non-empty and stable across two runs of a failing task", () => {
    const run = realRun("sh -c 'echo boom-line; exit 1'")
    const a = failureSignature(run(), ["boom"])
    expect(a).toContain("boom-line")
    expect(failureSignature(run(), ["boom"])).toBe(a)
  })

  it("is empty when the task prints nothing and only vp's own lines remain", () => {
    expect(failureSignature(realRun("sh -c 'exit 1'")(), ["boom"])).toBe("")
  })

  it("keeps a task-printed `$ ` line only when it is not vp's echo", () => {
    expect(failureSignature(realRun("sh -c 'echo quoted; exit 1'")(), ["boom"])).toContain("quoted")
  })
})

describe("failureSignature", () => {
  const tasks = ["test:unit", "lint"]

  it("is equal for outputs differing only in noise", () => {
    const a =
      "[p#test:unit] \x1b[31mFAIL\x1b[0m foo took 12ms at 10:01:02 on 2026-10-18T10:01:02.123Z hash 0123456789abcdef\n"
    const b =
      "[p#test:unit] FAIL foo took 3.4 s at 11:59:59 on 2026-10-19T01:00:00Z hash fedcba9876543210\n"
    expect(failureSignature(a, tasks)).toBe(failureSignature(b, tasks))
    expect(failureSignature(a, tasks)).not.toBe("")
  })

  it("is equal for outputs differing only in a 16-char hash", () => {
    expect(failureSignature("[p#lint] id 0123456789ABCDEF\n", tasks)).toBe(
      failureSignature("[p#lint] id fedcba9876543210\n", tasks),
    )
  })

  it("differs for 40-char shas", () => {
    expect(failureSignature(`[p#lint] at ${"a".repeat(40)}\n`, tasks)).not.toBe(
      failureSignature(`[p#lint] at ${"b".repeat(40)}\n`, tasks),
    )
  })

  it("differs for 12-char abbreviated shas", () => {
    expect(failureSignature("[p#lint] at aaaaaaaaaaaa\n", tasks)).not.toBe(
      failureSignature("[p#lint] at bbbbbbbbbbbb\n", tasks),
    )
  })

  it("differs when assertion text differs", () => {
    expect(failureSignature("[p#test:unit] expected 1 to be 2\n", tasks)).not.toBe(
      failureSignature("[p#test:unit] expected 1 to be 3\n", tasks),
    )
  })

  it("ignores vp's summary lines", () => {
    const body = "[p#test:unit] boom\n"
    expect(failureSignature(`${body}vp run: 0/10 cache hit (0%), 9/10 successful.\n`, tasks)).toBe(
      failureSignature(`${body}vp run: 3/10 cache hit (30%), 9/10 successful.\n`, tasks),
    )
  })

  it("is order-insensitive across interleaved tasks", () => {
    const a = "[p#test:unit] a1\n[p#lint] b1\n[p#test:unit] a2\n[p#lint] b2\n"
    const b = "[p#lint] b1\n[p#lint] b2\n[p#test:unit] a1\n[p#test:unit] a2\n"
    expect(failureSignature(a, tasks)).toBe(failureSignature(b, tasks))
  })

  it("keeps line order within a task", () => {
    expect(failureSignature("[p#lint] a\n[p#lint] b\n", tasks)).not.toBe(
      failureSignature("[p#lint] b\n[p#lint] a\n", tasks),
    )
  })

  const head = (cache: string) => `[p#lint] $ oxlint . ${cache}\n[p#lint] \n`

  it.each([
    "○ cache miss: 'src/a.ts' modified, executing",
    "○ cache miss: no previous cache entry found, executing",
    "◉ cache hit, replaying",
    "⊘ cache disabled",
  ])("is empty for a boilerplate-only block (%s)", (cache) => {
    expect(failureSignature(head(cache), tasks)).toBe("")
  })

  it("distinguishes an extra silently failing task", () => {
    const a = head("◉ cache hit, replaying") + "[p#lint] real error\n"
    const b = a + "[p#test:unit] $ vitest run --project unit\n"
    expect(failureSignature(a, tasks)).not.toBe(failureSignature(b, tasks))
  })

  it("keeps one real diagnostic, equal across states with differing cache reasons", () => {
    const a = failureSignature(
      head("○ cache miss: 'a' modified, executing") + "[p#lint] real error\n",
      tasks,
    )
    const b = failureSignature(
      head("○ cache miss: env 'GTD_FLAG_X' changed, executing") + "[p#lint] real error\n",
      tasks,
    )
    expect(a).toContain("real error")
    expect(a).toBe(b)
  })

  it("is empty with no task-prefixed line", () => {
    expect(failureSignature("some banner\n---\n[p#other] x\n", tasks)).toBe("")
  })
})

describe("runStates", () => {
  const fail = (text: string): TurboRun => ({ code: 1, stdout: `[p#test:unit] ${text}\n` })
  const run3 = (runs: readonly TurboRun[]) => {
    const lines: string[] = []
    const code = runStates(
      ["defaults", "alpha on", "beta on"]
        .slice(0, runs.length)
        .map((label) => ({ ...stateOf(label), tasks: ["test:unit"] })),
      stub(runs).run,
      (l) => lines.push(l),
    )
    return { lines, code }
  }
  const text = (lines: readonly string[]) => lines.join("\n")

  it("logs a single state's stdout, no pass/FAIL line, and returns its code verbatim", () => {
    const lines: string[] = []
    const { run } = stub([{ code: 3, stdout: "out\n" }])
    expect(runStates([stateOf("defaults")], run, (l) => lines.push(l))).toBe(3)
    expect(text(lines)).toContain("out")
    expect(text(lines)).not.toMatch(/pass|FAIL/)
  })

  it("maps a single state's null code to 1", () => {
    const { run } = stub([null])
    expect(runStates([stateOf("defaults")], run, () => {})).toBe(1)
  })

  it("logs one pass line per state, never stdout, and returns 0", () => {
    const { lines, code } = run3([
      { code: 0, stdout: "[p#test:unit] noisy pass\n" },
      { code: 0, stdout: "[p#test:unit] noisy pass\n" },
    ])
    expect(code).toBe(0)
    expect(lines).toEqual(["test-states: defaults — pass", "test-states: alpha on — pass"])
  })

  it("with full logs, prints pass stdout and never collapses a repeated failure", () => {
    const lines: string[] = []
    const runs = [
      { code: 0, stdout: "[p#test:unit] noisy pass\n" },
      fail("same boom"),
      fail("same boom"),
    ]
    const states = ["defaults", "alpha on", "beta on"].map((l) => ({
      ...stateOf(l),
      tasks: ["test:unit"],
    }))
    runStates(states, stub(runs).run, (l) => lines.push(l), { full: true })
    expect(text(lines)).toContain("noisy pass")
    expect(text(lines).match(/same boom/g)).toHaveLength(2)
    expect(text(lines)).not.toContain("same failure")
  })

  it("with collapse off, prints identical failures in full and passes only a label", () => {
    const lines: string[] = []
    const runs = [
      { code: 0, stdout: "[p#test:unit] noisy pass\n" },
      fail("same boom"),
      fail("same boom"),
    ]
    const states = ["defaults", "alpha on", "beta on"].map((l) => ({
      ...stateOf(l),
      tasks: ["test:unit"],
    }))
    runStates(states, stub(runs).run, (l) => lines.push(l), { collapse: false })
    expect(text(lines).match(/same boom/g)).toHaveLength(2)
    expect(text(lines)).not.toContain("same failure")
    expect(text(lines)).not.toContain("noisy pass")
    expect(lines[0]).toBe("test-states: defaults — pass")
  })

  it("prints the first failure in full, then its FAIL line", () => {
    const { lines, code } = run3([
      {
        code: 1,
        stdout:
          "[p#test:unit] FAIL my test\n[p#test:unit] AssertionError: nope\n[p#test:unit]   at x.ts:1\n",
      },
      { code: 0, stdout: "" },
    ])
    expect(code).toBe(1)
    const out = text(lines)
    expect(out).toContain("FAIL my test")
    expect(out).toContain("AssertionError: nope")
    expect(out).toContain("at x.ts:1")
    expect(out.indexOf("AssertionError")).toBeLessThan(out.indexOf("test-states: defaults — FAIL"))
    expect(lines.at(-1)).toBe("test-states: alpha on — pass")
  })

  it("collapses a repeated failure to one line naming the earlier state", () => {
    const { lines, code } = run3([fail("same boom 10ms"), fail("same boom 99ms")])
    expect(code).toBe(1)
    expect(lines.at(-1)).toBe("test-states: alpha on — FAIL (same failure as defaults)")
    expect(text(lines).match(/same boom/g)).toHaveLength(1)
  })

  it("prints a later distinct failure in full and matches the second for a third", () => {
    const { lines, code } = run3([fail("boom A"), fail("boom B"), fail("boom B")])
    expect(code).toBe(1)
    expect(text(lines)).toContain("boom A")
    expect(text(lines)).toContain("boom B")
    expect(text(lines).match(/boom B/g)).toHaveLength(1)
    expect(lines.at(-1)).toBe("test-states: beta on — FAIL (same failure as alpha on)")
  })

  it("prints both failures when signatures are empty", () => {
    const { lines, code } = run3([
      { code: 1, stdout: "weird one\n" },
      { code: 1, stdout: "weird one\n" },
    ])
    expect(code).toBe(1)
    expect(text(lines).match(/weird one/g)).toHaveLength(2)
    expect(text(lines)).not.toContain("same failure")
  })

  it("runs all three states in order when the middle one is red", () => {
    const { run, calls } = stub([0, 2, 0])
    const states = [stateOf("defaults"), stateOf("alpha on"), stateOf("beta on")]
    expect(runStates(states, run, () => {})).toBe(1)
    expect(calls.map((c) => c.env)).toEqual(states.map((s) => s.env))
    expect(calls.map((c) => c.tasks)).toEqual(states.map((s) => s.tasks))
  })

  it("counts a signal-killed (null) state as FAIL", () => {
    const { run } = stub([0, null])
    const lines: string[] = []
    const code = runStates([stateOf("defaults"), stateOf("alpha on")], run, (l) => lines.push(l))
    expect(lines[1]).toBe("test-states: alpha on — FAIL")
    expect(code).toBe(1)
  })
})
