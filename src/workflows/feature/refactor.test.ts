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

/** Runs `refactorFirst` against a recording context; `redFirst` makes the first health check red. */
const drive = async (
  given: DiffShapeResult,
  options: {
    readonly text?: TextContext
    readonly reference?: string
    readonly redFirst?: boolean
    readonly build?: readonly Change[]
    readonly fix?: readonly Change[]
    /** The fix turn's own changes, when they differ from the cumulative `fix`. */
    readonly fixTurn?: readonly Change[]
  } = {},
): Promise<Harness & { result: boolean | Error }> => {
  const steps: StepRequest[] = []
  const scopes: ScopeOptions[] = []
  let phase = "build"
  let checks = 0
  installContext(
    fixtureContext(options.text ?? { scope: "refactor" }, {
      step: (request: StepRequest) => {
        steps.push(request)
        if (request.kind === "agent" && request.name === "fix.suite.fixing") phase = "fix"
        if (request.kind === "run" && request.name === "health.check") {
          checks++
          phase = "check"
        }
        return Promise.resolve()
      },
      refuse: (message) => {
        throw new Error(message)
      },
      pushScope: (scope) => void scopes.push(scope),
      popScope: () => undefined,
      changesSince: () => (phase === "fix" ? (options.fix ?? []) : (options.build ?? [])),
      changes: () => {
        if (phase === "build") return options.build ?? []
        if (phase === "fix") return options.fixTurn ?? options.fix ?? []
        return options.redFirst && checks === 1
          ? [change(".gtd/FEEDBACK.md", undefined, "red", "added")]
          : []
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
    const h = await drive(shape(), { redFirst: true, fix: [change("lib/other.ts", "a", "b")] })
    expect(names(h)).toContain("fix.suite.fixing")
    expect((h.result as Error).message).toContain("lib/other.ts")
  })

  it("refuses a fix turn adding a flag read", async () => {
    const h = await drive(shape(), {
      redFirst: true,
      fix: [change("src/a.ts", "x", "GTD_FLAG_NEW")],
    })
    expect(names(h)).toContain("fix.suite.fixing")
    expect((h.result as Error).message).toContain("GTD_FLAG_NEW")
  })

  it("judges a fix turn on its own changes: an earlier non-stray edit does not wedge it", async () => {
    const h = await drive(shape(), {
      redFirst: true,
      fix: [change("lib/human.ts", "a", "b")],
      fixTurn: [change("src/a.ts", "a", "b")],
    })
    expect(h.result).toBe(true)
  })

  it("loads ponytail on the building and fix turns, and a config.skills entry replaces it", async () => {
    const h = await drive(shape(), { redFirst: true })
    const agents = h.steps.filter((s) => s.kind === "agent")
    expect(agents.map((s) => s.name)).toEqual(["building", "fix.suite.fixing"])
    for (const a of agents) expect(a.kind === "agent" ? a.prompt : "").toContain("ponytail")

    const custom = await drive(shape(), {
      redFirst: true,
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
})
