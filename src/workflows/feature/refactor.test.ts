import { afterEach, describe, expect, it } from "vitest"
import {
  installContext,
  type Change,
  type DiffShapeResult,
  type ScopeOptions,
  type StepRequest,
} from "../../flows/index.js"
import { fixtureContext, type TextContext } from "../shared/text.fixture.js"
import { refactorFirst, requireNoNewFlags, requireWithin, REFACTOR_PACKAGE } from "./refactor.js"

afterEach(() => installContext(undefined))

const change = (
  path: string,
  before: string | undefined,
  after: string | undefined,
  status: Change["status"] = "modified",
): Change => ({ path, status, before, after })

const refusal = (fn: () => void): string | undefined => {
  try {
    fn()
  } catch (error) {
    return (error as Error).message
  }
  return undefined
}

const withChanges = (list: readonly Change[], fn: () => void): string | undefined => {
  installContext(
    fixtureContext(
      {},
      {
        changes: () => list,
        changesSince: () => list,
        refuse: (message) => {
          throw new Error(message)
        },
      },
    ),
  )
  return refusal(fn)
}

describe("requireWithin", () => {
  it("passes for strays and .gtd/ paths", () => {
    const list = [change("src/a.ts", "a", "b"), change(".gtd/FEEDBACK.md", "", "x", "added")]
    expect(withChanges(list, () => requireWithin(["src/a.ts"]))).toBeUndefined()
  })

  it("refuses naming each other path", () => {
    const list = [
      change("src/a.ts", "a", "b"),
      change("lib/x.ts", "a", "b"),
      change("lib/y.ts", "a", "b"),
    ]
    const message = withChanges(list, () => requireWithin(["src/a.ts"]))
    expect(message).toContain("lib/x.ts")
    expect(message).toContain("lib/y.ts")
    expect(message).not.toContain("src/a.ts")
  })
})

describe("requireNoNewFlags", () => {
  const pattern = "\\bGTD_FLAG_\\w+"

  it("refuses a flag name absent before and present after", () => {
    const message = withChanges([change("src/a.ts", "x", "x GTD_FLAG_NEW")], () =>
      requireNoNewFlags(pattern, "h"),
    )
    expect(message).toContain("GTD_FLAG_NEW")
  })

  it("refuses a second read of an existing flag", () => {
    const message = withChanges([change("src/a.ts", "GTD_FLAG_A", "GTD_FLAG_A GTD_FLAG_A")], () =>
      requireNoNewFlags(pattern, "h"),
    )
    expect(message).toContain("GTD_FLAG_A")
  })

  it("counts an added file's flags against zero", () => {
    const message = withChanges([change("src/n.ts", undefined, "GTD_FLAG_Z", "added")], () =>
      requireNoNewFlags(pattern, "h"),
    )
    expect(message).toContain("GTD_FLAG_Z")
  })

  it("passes a read moved between files", () => {
    const list = [change("src/a.ts", "GTD_FLAG_A", ""), change("src/b.ts", "", "GTD_FLAG_A")]
    expect(withChanges(list, () => requireNoNewFlags(pattern, "h"))).toBeUndefined()
  })

  it("passes a deleted file's flags", () => {
    const list = [change("src/gone.ts", "GTD_FLAG_A", undefined, "deleted")]
    expect(withChanges(list, () => requireNoNewFlags(pattern, "h"))).toBeUndefined()
  })

  it("passes a swap that keeps every per-name count flat", () => {
    const list = [
      change("src/a.ts", "GTD_FLAG_A", "GTD_FLAG_B"),
      change("src/b.ts", "GTD_FLAG_B", "GTD_FLAG_A"),
    ]
    expect(withChanges(list, () => requireNoNewFlags(pattern, "h"))).toBeUndefined()
  })

  it("ignores flag names in .gtd/ files", () => {
    const list = [change(".gtd/FEEDBACK.md", "", "GTD_FLAG_X failed", "added")]
    expect(withChanges(list, () => requireNoNewFlags(pattern, "h"))).toBeUndefined()
  })

  describe("a pattern with a zero-length match", () => {
    const lookahead = "(?=GTD_FLAG_\\w+)"

    it("refuses a changed file holding a flag read, naming the setting and the path", () => {
      const message = withChanges([change("src/a.ts", "x", "x GTD_FLAG_A")], () =>
        requireNoNewFlags(lookahead, "h"),
      )
      expect(message).toContain("refactorFlagPattern")
      expect(message).toContain("zero-length match")
      expect(message).toContain("  - src/a.ts")
    })

    it("refuses a flag swap across two files that the default pattern passes", () => {
      const list = [
        change("src/a.ts", "GTD_FLAG_A", "GTD_FLAG_B"),
        change("src/b.ts", "GTD_FLAG_B", "GTD_FLAG_A"),
      ]
      expect(withChanges(list, () => requireNoNewFlags(pattern, "h"))).toBeUndefined()
      const message = withChanges(list, () => requireNoNewFlags(lookahead, "h"))
      expect(message).toContain("  - src/a.ts")
      expect(message).toContain("  - src/b.ts")
    })

    it("lists a path once when both sides match", () => {
      const message = withChanges([change("src/a.ts", "GTD_FLAG_A", "GTD_FLAG_B")], () =>
        requireNoNewFlags(lookahead, "h"),
      )
      expect(message?.match(/src\/a\.ts/g)).toHaveLength(1)
    })

    it("passes a file with no match on either side", () => {
      expect(
        withChanges([change("src/a.ts", "x", "y")], () => requireNoNewFlags(lookahead, "h")),
      ).toBeUndefined()
    })
  })

  it("refuses an unreadable side of a modified file", () => {
    expect(
      withChanges([change("src/a.ts", undefined, "x")], () => requireNoNewFlags(pattern, "h")),
    ).toContain("src/a.ts")
    expect(
      withChanges([change("src/a.ts", "x", undefined)], () => requireNoNewFlags(pattern, "h")),
    ).toContain("src/a.ts")
  })
})

const shape = (overrides: Partial<DiffShapeResult> = {}): DiffShapeResult => ({
  choice: "refactor-first",
  strays: ["src/a.ts", "src/b.ts"],
  unreadable: [],
  judgment: undefined,
  ...overrides,
})

interface Harness {
  readonly steps: StepRequest[]
  readonly scopes: ScopeOptions[]
}

/** The phase a step name enters; `fix.suite.fixing` is an agent step. */
const PHASE_AT: Record<string, string | undefined> = {
  "fix.suite.fixing": "fix",
  "health.describe": "describe",
  "health.stop": "stop",
  "health.exhausted": "stop",
}

/** Runs `refactorFirst` against a recording context; `reds` red checks come first. */
const drive = async (
  given: DiffShapeResult,
  options: {
    readonly text?: TextContext
    readonly reference?: string
    readonly build?: readonly Change[]
    readonly fix?: readonly Change[]
    /** The fix turn's own changes, when they differ from the cumulative `fix`. */
    readonly fixTurn?: readonly Change[]
    /** Red checks before the first green one. */
    readonly reds?: number
    /** The escalation describe turn's own changes. */
    readonly describe?: readonly Change[]
    /** A person's own changes at the `health.stop` rest. */
    readonly stop?: readonly Change[]
  } = {},
): Promise<Harness & { result: boolean | Error }> => {
  const steps: StepRequest[] = []
  const scopes: ScopeOptions[] = []
  let phase = "build"
  let checks = 0
  const reached = new Set<string>()
  const reds = options.reds ?? 0
  installContext(
    fixtureContext(options.text ?? { scope: "refactor" }, {
      step: (request: StepRequest) => {
        steps.push(request)
        const name = "name" in request ? request.name : ""
        phase = PHASE_AT[name] ?? phase
        reached.add(phase)
        if (request.kind === "run" && name === "health.check") {
          checks++
          phase = "check"
        }
        return Promise.resolve(
          request.kind === "judge" ? { answers: {}, truncated: [] } : undefined,
        )
      },
      refuse: (message) => {
        throw new Error(message)
      },
      pushScope: (scope) => void scopes.push(scope),
      popScope: () => undefined,
      // Cumulative like the live range: every turn reached so far, later phases included.
      changesSince: () => [
        ...(options.build ?? []),
        ...(reached.has("fix") ? (options.fix ?? []) : []),
        ...(reached.has("describe") ? (options.describe ?? []) : []),
        ...(reached.has("stop") ? (options.stop ?? []) : []),
      ],
      changes: () => {
        const turn: Record<string, readonly Change[] | undefined> = {
          build: options.build,
          fix: options.fixTurn ?? options.fix,
          describe: options.describe,
          stop: options.stop,
        }
        if (phase in turn) return turn[phase] ?? []
        return checks <= reds ? [change(".gtd/FEEDBACK.md", undefined, "red", "added")] : []
      },
      matches: (path, pattern) => path === pattern,
      head: () => "c0ffee0",
    }),
  )
  try {
    const result = await refactorFirst(given, { reference: options.reference })
    return { steps, scopes, result }
  } catch (error) {
    return { steps, scopes, result: error as Error }
  }
}

const names = (h: Harness): string[] => h.steps.map((s) => ("name" in s ? s.name : s.kind))

describe("refactorFirst", () => {
  it.each([
    ["land", shape({ choice: "land" })],
    ["reject", shape({ choice: "reject" })],
    ["refactor-first with unreadable strays", shape({ unreadable: ["src/a.ts"] })],
  ])("resolves false with no step for %s", async (_label, given) => {
    const h = await drive(given)
    expect(h.result).toBe(false)
    expect(h.steps).toEqual([])
  })

  it("throws before any step when a stray holds a flag read the pattern matches zero-length", async () => {
    const h = await drive(shape(), {
      text: {
        scope: "refactor",
        read: (path) => (path === "src/a.ts" ? "GTD_FLAG_X" : ""),
        vars: { refactorFlagPattern: "(?=GTD_FLAG_\\w+)" },
      },
    })
    expect(h.result).toBeInstanceOf(Error)
    expect((h.result as Error).message).toContain("refactorFlagPattern")
    expect((h.result as Error).message).toContain("  - src/a.ts")
    expect(h.steps).toEqual([])
  })

  it("derives, builds, checks and closes on a green run, resolving true", async () => {
    const h = await drive(shape())
    expect(h.result).toBe(true)
    expect(names(h)).toEqual(["deriving", "building", "health.check", "closing"])
    const closing = h.steps.at(-1)
    expect(closing).toMatchObject({ kind: "run" })
    const body = closing?.kind === "run" ? closing.body : ""
    expect(body).toContain(REFACTOR_PACKAGE)
  })

  it("writes a package whose scope lines equal the strays, in order, and marks them read-only", async () => {
    const h = await drive(shape({ strays: ["src/z.ts", "src/a.ts", "it's.ts"] }))
    const deriving = h.steps[0]
    const body = deriving?.kind === "run" ? deriving.body : ""
    expect(body).toContain(REFACTOR_PACKAGE)
    expect(body).not.toContain("<<")
    expect(body).toContain("## Scope (read-only)")
    expect(body).toContain("## Rules")
    expect(body).toContain("## Reference")
    // shell-unquote enough to read the printf arguments back
    const words = [...body.matchAll(/'((?:[^']|'\\'')*)'/g)].map((m) =>
      m[1]!.replaceAll("'\\''", "'"),
    )
    const lines = words.filter((w) => w.startsWith("- `"))
    expect(lines).toEqual(["- `src/z.ts`", "- `src/a.ts`", "- `it's.ts`"]) // gtd-path-exempt: fixture paths
  })

  it("runs inside a refactor scope whose write access is the strays plus .gtd/**", async () => {
    const h = await drive(shape())
    expect(h.scopes).toEqual([
      { name: "refactor", access: { write: ["src/a.ts", "src/b.ts", ".gtd/**"] } },
    ])
  })

  const bodyOf = (h: Harness, index: number): string => {
    const step = h.steps[index]
    return step?.kind === "run" ? step.body : ""
  }
  const buildingPrompt = (h: Harness): string => {
    const step = h.steps.find((s) => s.kind === "agent")
    return step?.kind === "agent" ? step.prompt : ""
  }

  it("names the reference hash as reference only, in prompt and package file", async () => {
    const h = await drive(shape(), { reference: "abc1234" })
    expect(buildingPrompt(h)).toContain("git show abc1234 -- ")
    expect(buildingPrompt(h)).toMatch(/never apply/i)
    expect(bodyOf(h, 0)).toContain("git show abc1234 -- '\\''src/a.ts'\\'' '\\''src/b.ts'\\''")
  })

  it.each([undefined, "", "  "])("omits the reference for %j", async (reference) => {
    const h = await drive(shape(), reference === undefined ? {} : { reference })
    expect(buildingPrompt(h)).not.toContain("git show")
    expect(bodyOf(h, 0)).toContain("None.")
  })

  it("refuses a build turn that touches a path outside the strays", async () => {
    const h = await drive(shape(), { build: [change("lib/other.ts", "a", "b")] })
    expect(h.result).toBeInstanceOf(Error)
    expect((h.result as Error).message).toContain("lib/other.ts")
    expect(names(h)).not.toContain("health.check")
  })

  it("refuses a build turn adding a flag read", async () => {
    const h = await drive(shape(), { build: [change("src/a.ts", "x", "GTD_FLAG_NEW")] })
    expect((h.result as Error).message).toContain("GTD_FLAG_NEW")
  })

  it("refuses a fix turn outside the strays", async () => {
    const h = await drive(shape(), { reds: 1, fix: [change("lib/other.ts", "a", "b")] })
    expect(names(h)).toContain("fix.suite.fixing")
    expect((h.result as Error).message).toContain("lib/other.ts")
  })

  it("refuses a fix turn adding a flag read", async () => {
    const h = await drive(shape(), {
      reds: 1,
      fix: [change("src/a.ts", "x", "GTD_FLAG_NEW")],
    })
    expect(names(h)).toContain("fix.suite.fixing")
    expect((h.result as Error).message).toContain("GTD_FLAG_NEW")
  })

  it("judges a fix turn on its own changes: an earlier non-stray edit does not wedge it", async () => {
    const h = await drive(shape(), {
      reds: 1,
      fix: [change("lib/human.ts", "a", "b")],
      fixTurn: [change("src/a.ts", "a", "b")],
    })
    expect(h.result).toBe(true)
  })

  it("loads ponytail on the building and fix turns, and a config.skills entry replaces it", async () => {
    const h = await drive(shape(), { reds: 1 })
    const agents = h.steps.filter((s) => s.kind === "agent")
    expect(agents.map((s) => s.name)).toEqual(["building", "fix.suite.fixing"])
    for (const a of agents) expect(a.kind === "agent" ? a.prompt : "").toContain("ponytail")

    const custom = await drive(shape(), {
      reds: 1,
      text: {
        scope: "refactor",
        skills: { refactor: ["my-skill"], "refactor.fix.suite": ["my-fix"] },
      },
    })
    const prompts = custom.steps.flatMap((s) => (s.kind === "agent" ? [s.prompt] : []))
    expect(prompts[0]).toContain("my-skill")
    expect(prompts[0]).not.toContain("ponytail")
    expect(prompts[1]).toContain("my-fix")
  })

  it.each(["", "   ", "(", "[a-", "x?", "(GTD_FLAG_\\w+)?"])(
    "throws naming refactorFlagPattern for %j, before any step",
    async (bad) => {
      const h = await drive(shape(), {
        text: { scope: "refactor", vars: { refactorFlagPattern: bad } },
      })
      expect(h.result).toBeInstanceOf(Error)
      expect((h.result as Error).message).toContain("refactorFlagPattern")
      expect(h.steps).toEqual([])
    },
  )

  it("falls back to the default pattern without the setting", async () => {
    const h = await drive(shape(), {
      text: { scope: "refactor", vars: {} },
      build: [change("src/a.ts", "", "GTD_FLAG_N")],
    })
    expect((h.result as Error).message).toContain("GTD_FLAG_N")
  })

  it("lets a custom pattern replace the default", async () => {
    const text = { scope: "refactor", vars: { refactorFlagPattern: "\\bFEATURE_\\w+" } }
    const ignored = await drive(shape(), { text, build: [change("src/a.ts", "", "GTD_FLAG_N")] })
    expect(ignored.result).toBe(true)
    const caught = await drive(shape(), { text, build: [change("src/a.ts", "", "FEATURE_N")] })
    expect((caught.result as Error).message).toContain("FEATURE_N")
  })

  describe("escalation", () => {
    // Four reds put the run at `health.describe` (the kit owns the count).
    const escalated = { reds: 4 }
    // Live, the write access refuses a non-stray first; this pins the guard itself.
    const exhausted = { reds: 12 }

    it("reaches the describe turn", async () => {
      const h = await drive(shape(), escalated)
      expect(names(h)).toContain("health.describe")
      expect(h.result).toBe(true)
    })

    it("refuses a describe turn outside the strays, naming the path", async () => {
      const h = await drive(shape(), { ...escalated, describe: [change("lib/other.ts", "a", "b")] })
      expect((h.result as Error).message).toContain("lib/other.ts")
      expect(names(h)).not.toContain("health.stop")
    })

    it("refuses a describe turn adding a flag read, naming the flag", async () => {
      const h = await drive(shape(), {
        ...escalated,
        describe: [change("src/a.ts", "x", "GTD_FLAG_NEW")],
      })
      expect((h.result as Error).message).toContain("GTD_FLAG_NEW")
      expect(names(h)).not.toContain("health.stop")
    })

    it("never refuses a human edit at health.stop", async () => {
      const h = await drive(shape(), { ...escalated, stop: [change("lib/human.ts", "a", "b")] })
      expect(names(h)).toContain("health.stop")
      expect(h.result).toBe(true)
    })

    it("never refuses a human edit at health.exhausted", async () => {
      const h = await drive(shape(), { ...exhausted, stop: [change("lib/human.ts", "a", "b")] })
      expect(names(h)).toContain("health.exhausted")
      expect(h.result).toBe(true)
    })

    it("refuses the next fix turn for a flag read a person added at the rest", async () => {
      const h = await drive(shape(), {
        ...escalated,
        stop: [change("lib/human.ts", "a", "a GTD_FLAG_NEW")],
      })
      expect((h.result as Error).message).toContain("GTD_FLAG_NEW")
    })
  })
})
