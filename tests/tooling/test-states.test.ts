import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { FLAGS, resolveFlags, type FlagDeclaration } from "../../src/flags/index.ts"
import {
  TASKS,
  VITEST_TASKS,
  planStates,
  failuresOf,
  runStates,
  spawnTurbo,
  turboArgv,
  type RunResult,
  type RunTasks,
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

const stub = (codes: readonly (number | null)[]) => {
  const calls: {
    tasks: readonly string[]
    env: Readonly<Record<string, string | undefined>>
  }[] = []
  const run: RunTasks = (tasks, env) => {
    calls.push({ tasks, env })
    return codes[calls.length - 1]!
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

describe("spawnTurbo", () => {
  it("returns null and reports when turbo cannot be spawned", async () => {
    const errors: unknown[] = []
    const original = console.error
    console.error = (...a: unknown[]) => errors.push(a[0])
    try {
      expect((await spawnTurbo([], { PATH: "/nonexistent" })).status).toBeNull()
    } finally {
      console.error = original
    }
    expect(String(errors[0])).toContain("cannot run turbo")
  })
})

describe("spawnTurbo against a shim turbo", () => {
  it("delivers forwarded args after the task names and captures output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "turbo-shim-"))
    const out = join(dir, "argv")
    writeFileSync(join(dir, "turbo"), `#!/bin/sh\nprintf '%s\\n' "$@" > "${out}"\necho hello\n`)
    chmodSync(join(dir, "turbo"), 0o755)
    const result = await spawnTurbo(["a", "b"], { PATH: dir }, ["--force"], false)
    expect(result).toEqual({ status: 0, output: "hello\n" })
    expect(readFileSync(out, "utf8").trim().split("\n")).toEqual(["run", "a", "b", "--force"])
  })
})

describe("turboArgv", () => {
  it("puts forwarded args after the task names", () => {
    expect(turboArgv(["a", "b"], ["--force"])).toEqual(["run", "a", "b", "--force"])
  })
})

describe("runStates", () => {
  it("returns a single state's code verbatim and logs nothing", async () => {
    const { run } = stub([3])
    const lines: string[] = []
    expect(await runStates([stateOf("defaults")], run, (l) => lines.push(l))).toBe(3)
    expect(lines).toEqual([])
  })

  it("logs one pass line per state and returns 0", async () => {
    const { run } = stub([0, 0])
    const lines: string[] = []
    const code = await runStates([stateOf("defaults"), stateOf("alpha on")], run, (l) =>
      lines.push(l),
    )
    expect(code).toBe(0)
    expect(lines).toEqual(["test-states: defaults — pass", "test-states: alpha on — pass"])
  })

  it("runs the flag-on state after a red all-off and returns 1", async () => {
    const { run, calls } = stub([1, 0])
    const lines: string[] = []
    const code = await runStates([stateOf("defaults"), stateOf("alpha on")], run, (l) =>
      lines.push(l),
    )
    expect(calls).toHaveLength(2)
    expect(lines[0]).toBe("test-states: defaults — FAIL")
    expect(lines[1]).toBe("test-states: alpha on — pass")
    expect(code).toBe(1)
  })

  it("runs all three states in order when the middle one is red", async () => {
    const { run, calls } = stub([0, 2, 0])
    const states = [stateOf("defaults"), stateOf("alpha on"), stateOf("beta on")]
    expect(await runStates(states, run, () => {})).toBe(1)
    expect(calls.map((c) => c.env)).toEqual(states.map((s) => s.env))
    expect(calls.map((c) => c.tasks)).toEqual(states.map((s) => s.tasks))
  })

  it("counts a signal-killed (null) state as FAIL", async () => {
    const { run } = stub([0, null])
    const lines: string[] = []
    const code = await runStates([stateOf("defaults"), stateOf("alpha on")], run, (l) =>
      lines.push(l),
    )
    expect(lines[1]).toBe("test-states: alpha on — FAIL")
    expect(code).toBe(1)
  })
})

const turboOut = (tasks: Record<string, readonly string[]>): string =>
  [
    ...Object.entries(tasks).flatMap(([task, lines]) => lines.map((l) => `${task}: ${l}`)),
    ` Tasks:    0 successful, ${Object.keys(tasks).length} total`,
    `Failed:    ${Object.keys(tasks)
      .map((t) => `@pmelab/gtd#${t}`)
      .join(", ")}`,
  ].join("\n")

describe("failuresOf", () => {
  const tasks = ["typecheck", "test:unit", "test:e2e:inmem"]

  it("maps each failed task to its failing test names, ignoring ansi and timing", () => {
    const out = turboOut({
      "test:unit": [" FAIL  a.test.ts > one [ 3ms ]", "\u001b[31m FAIL  a.test.ts > two\u001b[0m"],
      typecheck: ["error TS1"],
    })
    expect(failuresOf(out, tasks)).toEqual(
      new Map([
        ["test:unit", ["a.test.ts > one", "a.test.ts > two"]],
        ["typecheck", []],
      ]),
    )
  })

  it("is empty when no Failed line is present", () => {
    expect(failuresOf("boom", tasks).size).toBe(0)
  })
})

describe("runStates condensing", () => {
  const states = ["defaults", "alpha on", "beta on"].map((label) => ({
    label,
    tasks: ["typecheck", "test:unit"],
    env: {},
  }))
  const red = (extra: Record<string, readonly string[]> = {}): RunResult => ({
    status: 1,
    output: turboOut({ "test:unit": [" FAIL  a.test.ts > one"], ...extra }),
  })
  const green: RunResult = { status: 0, output: "all fine" }
  const feed = (results: readonly RunResult[]): RunTasks => {
    let i = 0
    return () => results[i++]!
  }
  const go = async (results: readonly RunResult[]) => {
    const lines: string[] = []
    const printed: string[] = []
    const code = await runStates(states, feed(results), (l) => lines.push(l), {
      print: (t) => printed.push(t),
    })
    return { code, lines, printed }
  }

  it("reprints nothing for identical later failures, naming the state they match", async () => {
    const { code, lines, printed } = await go([red(), red(), red()])
    expect(code).toBe(1)
    expect(printed).toEqual([])
    expect(lines).toEqual([
      "test-states: defaults — FAIL",
      "test-states: alpha on — FAIL",
      "test-states: alpha on — same failures as defaults",
      "test-states: beta on — FAIL",
      "test-states: beta on — same failures as defaults",
    ])
  })

  it("does not reprint the first state, which streamed live", async () => {
    const { printed } = await go([red(), green, green])
    expect(printed).toEqual([])
  })

  it("prints a pass line only for a later passing state", async () => {
    const { code, lines, printed } = await go([red(), green, red()])
    expect(code).toBe(1)
    expect(lines).toContain("test-states: alpha on — pass")
    expect(lines).toContain("test-states: beta on — same failures as defaults")
    expect(printed).toEqual([])
  })

  it("prints in full the first failing state when earlier ones passed", async () => {
    const { printed } = await go([green, red(), red()])
    expect(printed.join("")).toBe(red().output + "\n")
  })

  it("prints only the differing task's output for a flag-specific failure", async () => {
    const extra = { typecheck: ["error TS2322 flag-only"] }
    const { lines, printed } = await go([red(), red(extra), green])
    expect(printed.join("")).toBe("typecheck: error TS2322 flag-only\n")
    expect(lines.join("\n")).not.toContain("same failures")
  })

  it("treats the same task with different failing tests as different", async () => {
    const other: RunResult = {
      status: 1,
      output: turboOut({ "test:unit": [" FAIL  a.test.ts > other"] }),
    }
    const { printed } = await go([red(), other, green])
    expect(printed.join("")).toBe("test:unit:  FAIL  a.test.ts > other\n")
  })

  it("prints unparseable output in full rather than hiding it", async () => {
    const odd: RunResult = { status: 1, output: "turbo exploded" }
    const { printed } = await go([odd, odd, green])
    expect(printed.join("")).toBe("turbo exploded\n")
  })

  it("runs every state and returns 1 when any failed", async () => {
    const calls: boolean[] = []
    const run: RunTasks = (_t, _e, live) => {
      calls.push(live)
      return calls.length === 3 ? red() : green
    }
    expect(await runStates(states, run, () => {}, { print: () => {} })).toBe(1)
    expect(calls).toEqual([true, false, false])
  })

  it("exits 0 when every state passes", async () => {
    expect((await go([green, green, green])).code).toBe(0)
  })
})

describe("condense_failures flag", () => {
  it("is a declared release flag, so npm test also runs a state with it on", () => {
    const states = planStates(FLAGS, {})
    expect(FLAGS.find((f) => f.name === "condense_failures")).toMatchObject({ kind: "release" })
    expect(states.map((s) => s.label)).toContain("condense_failures on")
  })
})
