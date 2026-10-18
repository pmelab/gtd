import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import SilentReporter from "../vitest.reporter.ts"
import { resolveFlags, type FlagDeclaration } from "../../src/flags/index.ts"
import {
  TASKS,
  VITEST_TASKS,
  planStates,
  failuresOf,
  runStates,
  spawnTurbo,
  type Io,
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
    live: boolean
  }[] = []
  const run: RunTasks = (tasks, env, live) => {
    calls.push({ tasks, env, live })
    return { status: codes[calls.length - 1]!, output: "" }
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

const recorder = (tty = false) => {
  const sinks = { out: "", err: "" }
  const io: Io = {
    out: (t) => void (sinks.out += t),
    err: (t) => void (sinks.err += t),
    tty,
  }
  return { io, sinks }
}

const shimTurbo = (script: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "turbo-shim-"))
  writeFileSync(join(dir, "turbo"), `#!/bin/sh\n${script}\n`)
  chmodSync(join(dir, "turbo"), 0o755)
  return dir
}

const withShim = (dir: string, extra: Record<string, string> = {}) => ({
  PATH: `${dir}:/bin:/usr/bin`,
  ...extra,
})

describe("spawnTurbo", () => {
  it("reports through the err sink and returns null when turbo cannot be spawned", async () => {
    const { io, sinks } = recorder()
    const result = await spawnTurbo([], { PATH: "/nonexistent" }, [], false, io)
    expect(result.status).toBeNull()
    expect(sinks.err).toContain("cannot run turbo")
  })
})

describe("spawnTurbo against a shim turbo", () => {
  it("delivers forwarded args after the task names", async () => {
    const dir = shimTurbo(`printf '%s\\n' "$@" > "$OUT"`)
    const out = join(dir, "argv")
    await spawnTurbo(["a", "b"], withShim(dir, { OUT: out }), ["--force"], false, recorder().io)
    expect(readFileSync(out, "utf8").trim().split("\n")).toEqual([
      "run",
      "a",
      "b",
      "--continue=dependencies-successful",
      "--force",
    ])
  })

  for (const [live, tty, color] of [
    [true, true, true],
    [true, false, false],
    [false, true, false],
  ] as const) {
    it(`passes --color=${color} for live=${live} on a ${tty ? "TTY" : "pipe"}`, async () => {
      const dir = shimTurbo(`printf '%s\\n' "$@" > "$OUT"`)
      const out = join(dir, "argv")
      await spawnTurbo(["a"], withShim(dir, { OUT: out }), [], live, recorder(tty).io)
      expect(readFileSync(out, "utf8").split("\n").includes("--color")).toBe(color)
    })
  }

  it("captures both streams, and streams them only when live", async () => {
    const dir = shimTurbo(`echo out-line\necho err-line >&2`)
    const quiet = recorder()
    const quietRun = await spawnTurbo([], withShim(dir), [], false, quiet.io)
    expect(quiet.sinks).toEqual({ out: "", err: "" })
    const loud = recorder()
    const loudRun = await spawnTurbo([], withShim(dir), [], true, loud.io)
    expect(loud.sinks).toEqual({ out: "out-line\n", err: "err-line\n" })
    expect(quietRun.output.split("\n").sort()).toEqual(["", "err-line", "out-line"])
    expect(loudRun.output.split("\n").sort()).toEqual(["", "err-line", "out-line"])
  })

  it("keeps a multibyte character intact when it is split across chunks", async () => {
    const dir = shimTurbo(`printf '\\303'\nsleep 0.2\nprintf '\\227\\n'`)
    const run = await spawnTurbo([], withShim(dir), [], false, recorder().io)
    expect(run.output).toBe("×\n")
  })

  it("does not splice a stderr line into a stdout line split across chunks", async () => {
    const dir = shimTurbo(
      `printf 'test:unit: FA'\nsleep 0.1\necho 'typecheck: x' >&2\nsleep 0.1\nprintf 'IL a > one\\n'\necho 'Failed:    @pmelab/gtd#test:unit'`,
    )
    const run = await spawnTurbo(TASKS, withShim(dir), [], false, recorder().io)
    expect(failuresOf(run.output, TASKS)).toEqual(new Map([["test:unit", ["a > one"]]]))
  })

  it("keeps a trailing line without a newline", async () => {
    const dir = shimTurbo(`printf 'tail'`)
    expect((await spawnTurbo([], withShim(dir), [], false, recorder().io)).output).toBe("tail")
  })
})

describe("turboArgv", () => {
  const continuing = "--continue=dependencies-successful"

  it("runs independent failing tasks to completion and puts forwarded args last", () => {
    expect(turboArgv(["a", "b"], ["--force"])).toEqual(["run", "a", "b", continuing, "--force"])
  })

  it("forces colour only when asked", () => {
    expect(turboArgv(["a"], ["--force"], true)).toEqual([
      "run",
      "a",
      continuing,
      "--color",
      "--force",
    ])
  })
})

describe("runStates", () => {
  it("returns a single state's code verbatim and logs nothing", async () => {
    const { run } = stub([3])
    const lines: string[] = []
    expect(
      await runStates(
        [stateOf("defaults")],
        run,
        (l) => lines.push(l),
        () => {},
      ),
    ).toBe(3)
    expect(lines).toEqual([])
  })

  it("logs one pass line per state and returns 0", async () => {
    const { run } = stub([0, 0])
    const lines: string[] = []
    const code = await runStates(
      [stateOf("defaults"), stateOf("alpha on")],
      run,
      (l) => lines.push(l),
      () => {},
    )
    expect(code).toBe(0)
    expect(lines).toEqual(["test-states: defaults — pass", "test-states: alpha on — pass"])
  })

  it("runs the flag-on state after a red all-off and returns 1", async () => {
    const { run, calls } = stub([1, 0])
    const lines: string[] = []
    const code = await runStates(
      [stateOf("defaults"), stateOf("alpha on")],
      run,
      (l) => lines.push(l),
      () => {},
    )
    expect(calls).toHaveLength(2)
    expect(lines[0]).toBe("test-states: defaults — FAIL")
    expect(lines[1]).toBe("test-states: alpha on — pass")
    expect(code).toBe(1)
  })

  it("streams only the first state live", async () => {
    const { run, calls } = stub([0, 0, 0])
    await runStates(
      [stateOf("defaults"), stateOf("alpha on"), stateOf("beta on")],
      run,
      () => {},
      () => {},
    )
    expect(calls.map((c) => c.live)).toEqual([true, false, false])
  })

  it("runs all three states in order when the middle one is red", async () => {
    const { run, calls } = stub([0, 2, 0])
    const states = [stateOf("defaults"), stateOf("alpha on"), stateOf("beta on")]
    expect(
      await runStates(
        states,
        run,
        () => {},
        () => {},
      ),
    ).toBe(1)
    expect(calls.map((c) => c.env)).toEqual(states.map((s) => s.env))
    expect(calls.map((c) => c.tasks)).toEqual(states.map((s) => s.tasks))
  })

  it("counts a signal-killed (null) state as FAIL", async () => {
    const { run } = stub([0, null])
    const lines: string[] = []
    const code = await runStates(
      [stateOf("defaults"), stateOf("alpha on")],
      run,
      (l) => lines.push(l),
      () => {},
    )
    expect(lines[1]).toBe("test-states: alpha on — FAIL")
    expect(code).toBe(1)
  })
})

// Every task line carries a per-run cache hash, as real turbo prints for tasks whose env differs.
let hashes = 0
const turboOut = (tasks: Record<string, readonly string[]>): string =>
  [
    ...Object.entries(tasks).flatMap(([task, lines]) => [
      `${task}: cache miss, executing h${hashes++}`,
      ...lines.map((l) => `${task}: ${l}`),
    ]),
    ` Tasks:    0 successful, ${Object.keys(tasks).length} total`,
    `Failed:    ${Object.keys(tasks)
      .map((t) => `@pmelab/gtd#${t}`)
      .join(", ")}`,
  ].join("\n")

describe("failuresOf", () => {
  const tasks = ["typecheck", "test:unit", "test:e2e:inmem"]

  it("maps each failed task to its sorted, ansi-stripped FAIL names, or [] when it has none", () => {
    const out = turboOut({
      "test:unit": ["FAIL a > two", "\u001b[31mFAIL a > one\u001b[0m"],
      typecheck: ["error TS1"],
    })
    expect(failuresOf(out, tasks)).toEqual(
      new Map([
        ["test:unit", ["a > one", "a > two"]],
        ["typecheck", []],
      ]),
    )
  })

  it("is empty when no Failed line is present", () => {
    expect(failuresOf("boom", tasks).size).toBe(0)
  })

  it("reads what the repo reporter prints, ignoring message lines that start with FAIL", () => {
    const reporter = new SilentReporter()
    const failed = {
      fullName: "suite > one",
      module: { moduleId: join(process.cwd(), "tests/a.test.ts") },
      result: () => ({
        state: "failed",
        errors: [{ message: "FAIL sneaky\nFAIL second line" }],
      }),
    }
    const written: string[] = []
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((c) => {
      written.push(String(c))
      return true
    })
    try {
      reporter.onTestCaseResult(failed as never)
      reporter.onTestRunEnd(
        [
          { moduleId: join(process.cwd(), "tests/b.test.ts"), errors: () => [{ message: "boom" }] },
        ] as never,
        [{ message: "late throw\nstack" }] as never,
      )
    } finally {
      spy.mockRestore()
    }
    const out = written
      .join("")
      .split("\n")
      .map((l) => `test:unit: ${l}`)
      .concat("Failed:    @pmelab/gtd#test:unit")
      .join("\n")
    expect(failuresOf(out, tasks)).toEqual(
      new Map([
        [
          "test:unit",
          ["tests/a.test.ts > suite > one", "tests/b.test.ts", "unhandled error: late throw"],
        ],
      ]),
    )
  })
})

describe("runStates condensing", () => {
  const states = planStates([flag("alpha"), flag("beta")], {})
  const red = (extra: Record<string, readonly string[]> = {}): RunResult => ({
    status: 1,
    output: turboOut({ "test:unit": ["FAIL a > one"], ...extra }),
  })
  const green: RunResult = { status: 0, output: "all fine" }
  const feed = (results: readonly RunResult[]): RunTasks => {
    let i = 0
    return () => results[i++]!
  }
  const go = async (results: readonly RunResult[]) => {
    const lines: string[] = []
    const printed: string[] = []
    const code = await runStates(
      states,
      feed(results),
      (l) => lines.push(l),
      (t) => printed.push(t),
    )
    return { code, lines, printed }
  }

  it("reprints nothing for identical later failures, naming the state they match", async () => {
    const { code, lines, printed } = await go([red(), red(), red()])
    expect(code).toBe(1)
    expect(printed).toEqual([])
    expect(lines).toEqual([
      "test-states: defaults — FAIL",
      "test-states: alpha on — FAIL",
      "test-states: alpha on — failures already seen in defaults",
      "test-states: beta on — FAIL",
      "test-states: beta on — failures already seen in defaults",
    ])
  })

  it("does not reprint the first state, which streamed live", async () => {
    const { printed } = await go([red(), green, green])
    expect(printed).toEqual([])
  })

  it("a passing state in between does not break matching against defaults", async () => {
    const { code, lines, printed } = await go([red(), green, red()])
    expect(code).toBe(1)
    expect(lines).toContain("test-states: alpha on — pass")
    expect(lines).toContain("test-states: beta on — failures already seen in defaults")
    expect(printed).toEqual([])
  })

  it("treats a later state with a subset of an earlier state's failing tasks as already seen", async () => {
    const { printed, lines } = await go([red({ typecheck: ["error TS1"] }), red(), green])
    expect(printed).toEqual([])
    expect(lines).toContain("test-states: alpha on — failures already seen in defaults")
  })

  it("prints in full the first failing state when earlier ones passed", async () => {
    const first = red()
    const { printed } = await go([green, first, red()])
    expect(printed.join("")).toBe(first.output + "\n")
  })

  it("prints only the differing task's output for a flag-specific failure", async () => {
    const extra = { "test:workflows": ["FAIL w > flag-only", "  detail"] }
    const { lines, printed } = await go([red(), red(extra), green])
    expect(printed.join("")).toContain("test:workflows: FAIL w > flag-only\n")
    expect(printed.join("")).not.toContain("test:unit")
    expect(lines.join("\n")).not.toContain("already seen")
  })

  it("treats the same task with different failing tests as different", async () => {
    const other: RunResult = {
      status: 1,
      output: turboOut({ "test:unit": ["FAIL a > other"] }),
    }
    const { printed } = await go([red(), other, green])
    expect(printed.join("")).toContain("test:unit: FAIL a > other\n")
  })

  it("prints unparseable output in full rather than hiding it", async () => {
    const odd: RunResult = { status: 1, output: "turbo exploded" }
    const { printed } = await go([odd, odd, green])
    expect(printed.join("")).toBe("turbo exploded\n")
  })

  it("never calls two failures with no test names the same", async () => {
    const tc = (body: string): RunResult => ({
      status: 1,
      output: turboOut({ typecheck: [body] }),
    })
    const { printed, lines } = await go([tc("error TS1"), tc("error TS2"), tc("error TS1")])
    expect(printed.join("")).toContain("typecheck: error TS2\n")
    expect(printed.join("")).toContain("typecheck: error TS1\n")
    expect(lines.join("\n")).not.toContain("already seen")
  })

  it("prints the full output when a novel failure has no prefixed lines", async () => {
    const bare = (names: string): RunResult => ({
      status: 1,
      output: `Failed:    @pmelab/gtd#test:unit${names}`,
    })
    const { printed, lines } = await go([bare(""), bare(" "), green])
    expect(printed.join("")).toBe("Failed:    @pmelab/gtd#test:unit \n")
    expect(lines.join("\n")).not.toContain("already seen")
  })

  it("matches a state's failures spread over several earlier states", async () => {
    const a = { "test:unit": ["FAIL a > one"] }
    const b = { "test:workflows": ["FAIL w > one"] }
    const only = (t: Record<string, readonly string[]>): RunResult => ({
      status: 1,
      output: turboOut(t),
    })
    const { printed, lines } = await go([only(a), only(b), only({ ...a, ...b })])
    expect(printed.join("")).toContain("test:workflows: FAIL w > one\n")
    expect(lines.at(-1)).toBe("test-states: beta on — failures already seen in defaults, alpha on")
  })

  it("runs every state and returns 1 when any failed", async () => {
    const calls: boolean[] = []
    const run: RunTasks = (_t, _e, live) => {
      calls.push(live)
      return calls.length === 3 ? red() : green
    }
    expect(
      await runStates(
        states,
        run,
        () => {},
        () => {},
      ),
    ).toBe(1)
    expect(calls).toEqual([true, false, false])
  })

  it("exits 0 when every state passes", async () => {
    expect((await go([green, green, green])).code).toBe(0)
  })
})
