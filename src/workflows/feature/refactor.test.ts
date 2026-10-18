import { afterEach, describe, expect, it } from "vitest"
import {
  installContext,
  type Change,
  type DiffShapeResult,
  type ScopeOptions,
  type StepRequest,
} from "../../flows/index.js"
import { fixtureContext, type TextContext } from "../shared/text.fixture.js"
import { globMatches } from "../../wire/index.js"
import {
  refactorFirst,
  requireNoNewFlags,
  requireNoTestFiles,
  requireWithin,
  reviewedRefactor,
  REFACTOR_PACKAGE,
} from "./refactor.js"

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
        matches: globMatches,
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

describe("requireNoTestFiles", () => {
  it("refuses a changed test path, naming it, even when it is a stray", () => {
    const list = [
      change("src/a.test.ts", "a", "b"),
      change("tests/unit/b.ts", undefined, "x", "added"),
      change("src/__tests__/c.ts", "a", undefined, "deleted"),
      change("features/d.feature", "a", "b"),
    ]
    const message = withChanges(list, () => requireNoTestFiles())
    expect(message).toMatch(/^gtd land: refactor-tests: /)
    for (const path of [
      "src/a.test.ts",
      "tests/unit/b.ts",
      "src/__tests__/c.ts",
      "features/d.feature",
    ])
      expect(message).toContain(`  - ${path}`)
  })

  it("passes non-test paths and .gtd/ paths", () => {
    const list = [
      change("src/a.ts", "a", "b"),
      change(".gtd/tests/x.md", "", "x", "added"),
      change(".gtd/REFACTOR.md", "", "x", "added"),
    ]
    expect(withChanges(list, () => requireNoTestFiles())).toBeUndefined()
  })

  it("names only the test paths", () => {
    const message = withChanges(
      [change("src/a.ts", "a", "b"), change("src/a.spec.ts", "a", "b")],
      () => requireNoTestFiles(),
    )
    expect(message).toContain("src/a.spec.ts")
    expect(message).not.toContain("src/a.ts")
  })

  it("is not narrowed by a narrowed seamAllow", () => {
    installContext(
      fixtureContext(
        { vars: { seamAllow: "docs/**" } },
        {
          changes: () => [change("src/a.test.ts", "a", "b")],
          matches: globMatches,
          refuse: (message) => {
            throw new Error(message)
          },
        },
      ),
    )
    expect(refusal(() => requireNoTestFiles())).toContain("src/a.test.ts")
  })

  it("does not refuse other naming such as _test.go or test_*.py", () => {
    const list = [change("pkg/a_test.go", "a", "b"), change("pkg/test_a.py", "a", "b")]
    expect(withChanges(list, () => requireNoTestFiles())).toBeUndefined()
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
      matches: globMatches,
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

  it("refuses a build turn changing a test file even when it is a stray", async () => {
    const h = await drive(shape({ strays: ["src/a.test.ts"] }), {
      build: [change("src/a.test.ts", "a", "b")],
    })
    expect((h.result as Error).message).toContain("refactor-tests")
    expect((h.result as Error).message).toContain("src/a.test.ts")
    expect(names(h)).not.toContain("health.check")
  })

  it("says never a test file in the package rules", async () => {
    const h = await drive(shape())
    expect(bodyOf(h, 0)).toContain("never a test file")
    expect(bodyOf(h, 0)).not.toContain("only when it is one of them")
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

const REVIEW = ".gtd/REVIEW.md"
const QUALITY = ".gtd/QUALITY.md"

const reviewDoc = (note: string): string =>
  [
    "# Review: abc1234",
    "",
    "<!-- base: 0000000000000000000000000000000000000000 -->",
    "",
    "## calc",
    "- [ ] ./src/a.ts#1-1",
    note,
    "",
  ].join("\n")

interface Reviewed {
  /** Full step names, scope-qualified like the live replay. */
  readonly names: string[]
  readonly steps: StepRequest[]
  readonly result: boolean | Error
}

interface ReviewedScript {
  /** The note the human leaves at each `review.await-review`, in order; `undefined` signs off. */
  readonly notes?: readonly (string | undefined)[]
  readonly answers?: Readonly<Record<string, { answer: string; p: number }>>
  /** Findings every quality lens leaves behind, until the fix turn removes them. */
  readonly findings?: boolean
  /** Red checks before green. */
  readonly reds?: number
  /** The turn's own changes by full step name. */
  readonly turns?: Readonly<Record<string, readonly Change[]>>
  readonly vars?: Readonly<Record<string, string>>
  /** The collecting turn writes no package. */
  readonly silentCollect?: boolean
}

/** Runs `reviewedRefactor` against a scripted context; a third await-review stops the run. */
const driveReviewed = async (
  given: DiffShapeResult,
  script: ReviewedScript = {},
): Promise<Reviewed> => {
  const names: string[] = []
  const steps: StepRequest[] = []
  const stack: string[] = []
  const files = new Map<string, string>()
  let last = ""
  let awaits = 0
  let reds = script.reds ?? 0
  let checking = false
  let pending: boolean | Error = false
  const record = (request: Exclude<StepRequest, { kind: "restart" }>): void => {
    last = [...stack, request.name].join(".")
    names.push(last)
    steps.push(request)
    // Red checks apply to the tail's own runs, never the refactor lap's.
    checking = request.name === "health.check" && stack.includes("build")
    if (checking && reds > 0) reds--
  }
  const lensEffects = ["correctness", "ponytail-review", "conventions"].map(
    (lens): [string, () => void] => [
      `quality.${lens}.reviewing`,
      () => {
        if (script.findings) files.set(QUALITY, "- finding")
      },
    ],
  )
  const effects: Record<string, () => void> = {
    ...Object.fromEntries(lensEffects),
    deriving: () => void files.set(REFACTOR_PACKAGE, "package"),
    closing: () => void files.delete(REFACTOR_PACKAGE),
    "review.reviewing": () => void files.set(REVIEW, reviewDoc("add")),
    "review.closing": () => void files.delete(REVIEW),
    "review.collecting": () => {
      if (!script.silentCollect) files.set(REFACTOR_PACKAGE, "collected concern")
    },
    "fix.quality.fixing": () => void files.delete(QUALITY),
    "review.await-review": () => {
      const note = script.notes?.[awaits]
      if (++awaits > (script.notes?.length ?? 1)) throw new Error("stop")
      files.set(REVIEW, reviewDoc(note ?? "add"))
    },
  }
  installContext(
    fixtureContext(
      { scope: "refactor", vars: script.vars ?? {} },
      {
        step: (request: StepRequest) => {
          if (request.kind === "restart") return Promise.resolve()
          record(request)
          effects[request.name]?.()
          return Promise.resolve(
            request.kind === "judge" ? { answers: script.answers ?? {}, truncated: [] } : undefined,
          )
        },
        refuse: (message) => {
          throw new Error(message)
        },
        pushScope: (scope) => void stack.push(scope.name ?? ""),
        popScope: () => void stack.pop(),
        read: (path) => files.get(path),
        changes: () =>
          checking && reds > 0
            ? [change(".gtd/FEEDBACK.md", undefined, "red", "added")]
            : [...(script.turns?.[last] ?? [])],
        changesSince: () => {
          const after = files.get(REVIEW)
          return after === reviewDoc("add")
            ? []
            : [{ path: REVIEW, status: "modified", before: reviewDoc("add"), after }]
        },
        matches: globMatches,
        head: () => `c${names.length}`,
      },
    ),
  )
  try {
    pending = await reviewedRefactor(given)
  } catch (error) {
    pending = error as Error
  }
  return { names, steps, result: pending }
}

describe("reviewedRefactor", () => {
  it.each([
    ["land", shape({ choice: "land" })],
    ["reject", shape({ choice: "reject" })],
    ["refactor-first with unreadable strays", shape({ unreadable: ["src/a.ts"] })],
  ])("resolves false with no step for %s", async (_label, given) => {
    const h = await driveReviewed(given)
    expect(h.result).toBe(false)
    expect(h.steps).toEqual([])
  })

  it("closes the package, then runs the tail as refactor.build.* and signs off with true", async () => {
    const h = await driveReviewed(shape())
    expect(h.result).toBe(true)
    expect(h.names).toEqual([
      "refactor.deriving",
      "refactor.building",
      "refactor.health.check",
      "refactor.closing",
      "refactor.build.quality.correctness.reviewing",
      "refactor.build.quality.ponytail-review.reviewing",
      "refactor.build.quality.conventions.reviewing",
      "refactor.build.review.reviewing",
      "refactor.build.review.await-review",
      "refactor.build.review.closing",
    ])
  })

  it("reviews from HEAD at scope entry", async () => {
    const h = await driveReviewed(shape())
    const reviewing = h.steps.find((s) => s.kind === "agent" && s.name === "review.reviewing")
    expect(reviewing?.kind === "agent" ? reviewing.prompt : "").toContain("base: c0")
  })

  it("takes its quality lenses from refactorQualityReviews, none when blank", async () => {
    const one = await driveReviewed(shape(), { vars: { refactorQualityReviews: "correctness" } })
    expect(one.names.filter((n) => n.includes(".quality."))).toEqual([
      "refactor.build.quality.correctness.reviewing",
    ])
    const none = await driveReviewed(shape(), {
      vars: { refactorQualityReviews: "", qualityReviews: "correctness" },
    })
    expect(none.names.filter((n) => n.includes(".quality."))).toEqual([])
  })

  describe("on review feedback", () => {
    const run = () =>
      driveReviewed(shape(), {
        notes: ["add — rename it", undefined],
      })

    it("collects into the refactor package, re-unwinds, then derives and builds again, never a re-plan", async () => {
      const h = await run()
      const i = h.names.indexOf("refactor.build.review.collecting")
      expect(i).toBeGreaterThan(-1)
      expect(h.names.slice(i - 2, i + 6)).toEqual([
        "refactor.build.review.triage",
        "refactor.build.review.closing",
        "refactor.build.review.collecting",
        "refactor.re-unwind",
        "refactor.deriving",
        "refactor.building",
        "refactor.health.check",
        "refactor.closing",
      ])
      expect(h.names.some((n) => n.startsWith("design"))).toBe(false)
    })

    it("re-derives a package with the collected text under ## Review feedback and the strays fixed", async () => {
      const h = await run()
      const derivings = h.steps.filter((s) => s.kind === "run" && s.name === "deriving")
      expect(derivings).toHaveLength(2)
      const body = derivings[1]?.kind === "run" ? derivings[1].body : ""
      expect(body).toContain("Review feedback")
      expect(body).toContain("collected concern")
      expect(body).toContain("- `src/a.ts`") // gtd-path-exempt: fixture paths
      expect(body).toContain("- `src/b.ts`") // gtd-path-exempt: fixture paths
      const first = derivings[0]?.kind === "run" ? derivings[0].body : ""
      expect(first).not.toContain("Review feedback")
    })

    it("builds with the feedback line on the second lap only", async () => {
      const h = await run()
      const builds = h.steps.filter((s) => s.kind === "agent" && s.name === "building")
      const prompts = builds.map((s) => (s.kind === "agent" ? s.prompt : ""))
      expect(prompts[0]).not.toContain("## Review feedback")
      expect(prompts[1]).toContain("## Review feedback")
    })

    it("collects with the refactor prompt, naming .gtd/REFACTOR.md", async () => {
      const h = await run()
      const collecting = h.steps.find((s) => s.kind === "agent" && s.name === "review.collecting")
      const prompt = collecting?.kind === "agent" ? collecting.prompt : ""
      expect(prompt).toContain(".gtd/REFACTOR.md")
      expect(prompt).not.toContain(".gtd/REQUIREMENTS.md")
    })
  })

  describe("a note the collecting turn leaves out", () => {
    it("refuses the landing naming the note and gtd abandon, never signing off", async () => {
      const h = await driveReviewed(shape(), { notes: ["add — rename it"], silentCollect: true })
      const message = (h.result as Error).message
      expect(h.result).toBeInstanceOf(Error)
      expect(message).toContain("refactor-feedback")
      expect(message).toContain("note-1")
      expect(message).toContain("rename it")
      expect(message).toContain("gtd abandon")
    })
  })

  describe("the guard", () => {
    const outside = [change("lib/other.ts", "a", "b")]

    it("runs after a quality-fix turn", async () => {
      const h = await driveReviewed(shape(), {
        findings: true,
        turns: { "refactor.build.fix.quality.fixing": outside },
      })
      expect((h.result as Error).message).toContain("lib/other.ts")
      expect(h.names.at(-1)).toBe("refactor.build.fix.quality.fixing")
    })

    it("runs after a nit-fix turn", async () => {
      const h = await driveReviewed(shape({ strays: ["src/a.test.ts"] }), {
        notes: ["add — typo"],
        answers: { "note-1": { answer: "nit", p: 0.9 } },
        turns: { "refactor.build.review.fix.nits.fixing": [change("src/a.test.ts", "a", "b")] },
      })
      expect((h.result as Error).message).toContain("refactor-tests")
      expect(h.names.at(-1)).toBe("refactor.build.review.fix.nits.fixing")
    })

    it("runs after a fix-check turn", async () => {
      const h = await driveReviewed(shape({ strays: ["src/a.test.ts"] }), {
        notes: ["add — typo"],
        answers: { "note-1": { answer: "nit", p: 0.9 } },
        reds: 2,
        turns: { "refactor.build.fix": [change("src/a.test.ts", "x", "y")] },
      })
      expect(h.names).toContain("refactor.build.fix")
      expect((h.result as Error).message).toContain("refactor-tests")
      expect(h.names.at(-1)).toBe("refactor.build.fix")
    })

    it("never refuses a person's edit at the tail's health.stop", async () => {
      const h = await driveReviewed(shape(), {
        findings: true,
        reds: 5,
        turns: { "refactor.build.health.stop": [change("lib/human.test.ts", "a", "b")] },
      })
      expect(h.names).toContain("refactor.build.health.stop")
      expect(h.result).toBe(true)
    })

    it("still refuses the tail's escalation describe turn outside the strays", async () => {
      const h = await driveReviewed(shape(), {
        findings: true,
        reds: 5,
        turns: { "refactor.build.health.describe": outside },
      })
      expect((h.result as Error).message).toContain("lib/other.ts")
      expect(h.names.at(-1)).toBe("refactor.build.health.describe")
    })
  })
})
