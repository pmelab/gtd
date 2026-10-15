import { describe, expect, it } from "vitest"
import { resolveFlags, type FlagDeclaration } from "../../src/flags/index.ts"
import {
  TASKS,
  VITEST_TASKS,
  planStates,
  runStates,
  spawnTurbo,
  type RunTasks,
  type TestState,
} from "../../scripts/test-states.ts"

const flag = (name: string, kind: FlagDeclaration["kind"] = "release"): FlagDeclaration => ({
  name,
  owner: "test",
  expiry: "2099-01-01",
  kind,
})

const stateOf = (name: string | undefined): TestState => ({
  on: name,
  tasks: name ? [`test:${name}`] : TASKS,
  env: name ? { [`GTD_FLAG_${name.toUpperCase()}`]: "1" } : {},
})

const stub = (codes: readonly (number | null)[]) => {
  const calls: { tasks: readonly string[]; env: Readonly<Record<string, string | undefined>> }[] =
    []
  const run: RunTasks = (tasks, env) => {
    calls.push({ tasks, env })
    return codes[calls.length - 1]!
  }
  return { run, calls }
}

describe("planStates", () => {
  it("plans exactly one all-off state for an empty registry", () => {
    const states = planStates([], {})
    expect(states).toHaveLength(1)
    expect(states[0]!.on).toBeUndefined()
    expect(states[0]!.tasks).toEqual(TASKS)
  })

  it("ignores ops and experiment flags", () => {
    const states = planStates([flag("a", "ops"), flag("b", "experiment")], {})
    expect(states).toHaveLength(1)
  })

  it("plans all-off then one flag-on state for one release flag", () => {
    const states = planStates([flag("alpha")], {})
    expect(states).toHaveLength(2)
    expect(states[0]!.tasks).toEqual(TASKS)
    expect(states[1]!.on).toBe("alpha")
    expect(states[1]!.tasks).toEqual(VITEST_TASKS)
    expect(states[1]!.env["GTD_FLAG_ALPHA"]).toBe("1")
  })

  it("plans three states for two release flags, each setting only its own variable", () => {
    const states = planStates([flag("alpha"), flag("beta")], {})
    expect(states.map((s) => s.on)).toEqual([undefined, "alpha", "beta"])
    const flagKeys = (s: TestState) => Object.keys(s.env).filter((k) => k.startsWith("GTD_FLAG_"))
    expect(flagKeys(states[0]!)).toEqual([])
    expect(flagKeys(states[1]!)).toEqual(["GTD_FLAG_ALPHA"])
    expect(flagKeys(states[2]!)).toEqual(["GTD_FLAG_BETA"])
  })

  it("strips every inherited GTD_FLAG_* and keeps other variables", () => {
    const inherited = { GTD_FLAG_ALPHA: "1", GTD_FLAG_OTHER: "true", PATH: "/bin" }
    const states = planStates([flag("alpha"), flag("beta")], inherited)
    for (const s of states) {
      expect(s.env["GTD_FLAG_OTHER"]).toBeUndefined()
      expect(s.env["PATH"]).toBe("/bin")
    }
    expect(states[0]!.env["GTD_FLAG_ALPHA"]).toBeUndefined()
    expect(states[2]!.env["GTD_FLAG_ALPHA"]).toBeUndefined()
    expect(states[1]!.env["GTD_FLAG_ALPHA"]).toBe("1")
  })
})

describe("planStates and resolveFlags agree on the variable name", () => {
  it("each state resolves exactly its own flag on", () => {
    const registry = [flag("alpha"), flag("kebab-Case")] as const
    for (const state of planStates(registry, {})) {
      for (const { name } of registry) {
        expect(resolveFlags(state.env, registry)[name]).toBe(state.on === name)
      }
    }
  })
})

describe("spawnTurbo", () => {
  it("returns null and reports when turbo cannot be spawned", () => {
    const errors: unknown[] = []
    const original = console.error
    console.error = (...a: unknown[]) => errors.push(a[0])
    try {
      expect(spawnTurbo([], { PATH: "/nonexistent" })).toBeNull()
    } finally {
      console.error = original
    }
    expect(String(errors[0])).toContain("cannot run turbo")
  })
})

describe("runStates", () => {
  it("returns a single state's code verbatim and logs nothing", () => {
    const { run } = stub([3])
    const lines: string[] = []
    expect(runStates([stateOf(undefined)], run, (l) => lines.push(l))).toBe(3)
    expect(lines).toEqual([])
  })

  it("logs one pass line per state and returns 0", () => {
    const { run } = stub([0, 0])
    const lines: string[] = []
    const code = runStates([stateOf(undefined), stateOf("alpha")], run, (l) => lines.push(l))
    expect(code).toBe(0)
    expect(lines).toEqual(["test-states: all off — pass", "test-states: alpha on — pass"])
  })

  it("runs the flag-on state after a red all-off and returns 1", () => {
    const { run, calls } = stub([1, 0])
    const lines: string[] = []
    const code = runStates([stateOf(undefined), stateOf("alpha")], run, (l) => lines.push(l))
    expect(calls).toHaveLength(2)
    expect(lines[0]).toBe("test-states: all off — FAIL")
    expect(lines[1]).toBe("test-states: alpha on — pass")
    expect(code).toBe(1)
  })

  it("runs all three states in order when the middle one is red", () => {
    const { run, calls } = stub([0, 2, 0])
    const states = [stateOf(undefined), stateOf("alpha"), stateOf("beta")]
    expect(runStates(states, run, () => {})).toBe(1)
    expect(calls.map((c) => c.env)).toEqual(states.map((s) => s.env))
    expect(calls.map((c) => c.tasks)).toEqual(states.map((s) => s.tasks))
  })

  it("counts a signal-killed (null) state as FAIL", () => {
    const { run } = stub([0, null])
    const lines: string[] = []
    const code = runStates([stateOf(undefined), stateOf("alpha")], run, (l) => lines.push(l))
    expect(lines[1]).toBe("test-states: alpha on — FAIL")
    expect(code).toBe(1)
  })
})
