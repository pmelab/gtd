import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  feedback: undefined as string | undefined,
  head: "h1",
  pending: [] as unknown[],
  files: {} as Record<string, string | undefined>,
  since: [] as { path: string; status: string; before?: string; after?: string }[],
  agentThread: false,
  humanThread: false,
}))

vi.mock("../flows/index.js", () => ({
  changes: () => state.pending,
  changesSince: () =>
    Object.assign([...state.since], {
      paths: state.since.map((c) => c.path),
      get: (path: string) => state.since.find((c) => c.path === path),
    }),
  hasThreadFor: (who: string) => (who === "agent" ? state.agentThread : state.humanThread),
  head: () => state.head,
  read: (path: string) => (path === "f.md" ? state.feedback : state.files[path]),
  refuse: (m: string) => {
    throw new Error(m)
  },
  requireReplies: () => {},
  requireThreadsClosed: () => {},
}))

import {
  review,
  reviewToHandOff,
  routeNotes,
  type HandOffPolicy,
  type Requested,
  type ReviewPolicy,
  type Verdict,
} from "./review.js"
import type { ReviewNote } from "../steering/index.js"

const note = (id: string) => ({ id }) as unknown as ReviewNote

const setup = (verdicts: Record<string, Verdict>, silent = false, dropped = false) => {
  const calls: string[] = []
  const deferred: string[][] = []
  const collected: ReviewNote[][] = []
  const p = {
    file: "r.md",
    feedback: "f.md",
    triage: async () => new Map(Object.entries(verdicts)),
    answerQuestions: async () => void calls.push("answer"),
    fixNits: async () => void calls.push("nits"),
    keepGreen: async () => void calls.push("green"),
    collecting: async () => {
      calls.push("collect")
      if (!silent) state.feedback = "x"
    },
    captures: {
      editNotes: (_r: string, edits: readonly ReviewNote[]) => {
        collected.push([...edits])
        return "cap"
      },
    },
    refusals: dropped
      ? {
          dropped: (r: Requested) =>
            `dropped: ${r.notes.map((n) => n.id).join(",")} / ${r.paths.join(",")}`,
        }
      : {},
    defer: async (ns: readonly ReviewNote[]) => {
      calls.push("defer")
      deferred.push(ns.map((n) => n.id))
    },
  } as unknown as ReviewPolicy
  const r = {
    round: "r1",
    close: async () => void calls.push("close"),
    outcome: (verdict: "signoff" | "feedback") => ({ verdict }) as never,
    unfolded: async () => ({ verdict: "signoff" }) as never,
  }
  return { p, r, calls, deferred, collected }
}

beforeEach(() => {
  state.feedback = undefined
  state.pending = []
  state.files = {}
  state.since = []
  state.agentThread = false
  state.humanThread = false
})

describe("routeNotes defer", () => {
  it("defer-only round awaits again, no collecting turn", async () => {
    const t = setup({ a: "defer", b: "defer" })
    const res = await routeNotes(t.p, [note("a"), note("b")], t.r)
    expect(res).toEqual({ next: "await", reviewed: "r1" })
    expect(t.deferred).toEqual([["a", "b"]])
    expect(t.calls).toEqual(["defer"])
  })

  it("defer + edit collects only the edits and ends feedback", async () => {
    const t = setup({ a: "defer", b: "edit" })
    const res = await routeNotes(t.p, [note("a"), note("b")], t.r)
    expect(res).toEqual({ verdict: "feedback" })
    expect(t.calls).toEqual(["defer", "close", "collect"])
    expect(t.collected[0]!.map((n) => n.id)).toEqual(["b"])
  })

  it("runs after nit fixes and before the collecting turn", async () => {
    const t = setup({ a: "nit", b: "defer", c: "edit" })
    await routeNotes(t.p, [note("a"), note("b"), note("c")], t.r)
    expect(t.calls).toEqual(["nits", "green", "defer", "close", "collect"])
  })
})

describe("routeNotes dropped", () => {
  it("an edit note whose collecting turn writes nothing is refused naming the note", async () => {
    const t = setup({ a: "edit" }, true, true)
    await expect(routeNotes(t.p, [note("a")], t.r)).rejects.toThrow("dropped: a / ")
  })

  it("signs off when no dropped refusal is set", async () => {
    const t = setup({ a: "edit" }, true)
    expect(await routeNotes(t.p, [note("a")], t.r)).toEqual({ verdict: "signoff" })
  })

  it("a collecting turn that changed something else is unmatched, not dropped", async () => {
    const t = setup({ a: "edit" }, true, true)
    Object.assign(t.p.refusals, { unmatched: "unmatched" })
    state.pending = [{ path: "x" }]
    await expect(routeNotes(t.p, [note("a")], t.r)).rejects.toThrow("unmatched")
  })

  it("a praise-only round never collects, so signs off", async () => {
    const t = setup({ a: "praise" }, true, true)
    expect(await routeNotes(t.p, [note("a")], t.r)).toEqual({ verdict: "signoff" })
  })
})

const doc = (...body: string[]): string =>
  [
    "# Review: abc1234",
    "",
    "<!-- base: 0000000000000000000000000000000000000000 -->",
    "",
    "## calc",
    "",
    ...body,
    "",
  ].join("\n")

const POINTER = "- [ ] ./a.ts#1-1 does x"
const thread = (...entries: string[]): string =>
  ["[^t]:", ...entries.map((e) => `    - ${e}`)].join("\n")
const oneShot = (id: string, text: string): string => `[^${id}]:\n    ${text}`

/** Drives `review` over one round: `before` is the file as reviewed, `after` what the human left. */
const driveRound = async (
  before: string,
  after: string,
  opts: {
    verdicts?: Record<string, Verdict>
    inGate?: string
    handEdit?: boolean
    silent?: boolean
  } = {},
) => {
  const triaged: string[][] = []
  const dropped: Requested[] = []
  let awaits = 0
  const p = {
    file: "r.md",
    feedback: "f.md",
    isCode: (path: string) => path.endsWith(".ts"),
    reviewing: async () => void (state.files["r.md"] = before),
    fixRisks: async () => {},
    keepGreen: async () => {},
    awaitReview: async () => {
      awaits++
      if (awaits > 2 || (awaits > 1 && opts.inGate === undefined)) throw new Error("stop")
      if (opts.inGate !== undefined && awaits === 1) {
        state.agentThread = true
        return
      }
      state.humanThread = false
      state.files["r.md"] = after
      state.since = [{ path: "r.md", status: "modified", before, after }]
      if (opts.handEdit)
        state.since.push({ path: "a.ts", status: "modified", before: "a", after: "b" })
    },
    reviewMissing: async () => {},
    collecting: async () => {
      if (opts.inGate !== undefined && state.agentThread) {
        state.agentThread = false
        state.humanThread = true
        state.files["r.md"] = opts.inGate
        return
      }
      if (!opts.silent) state.feedback = "x"
    },
    triage: async (ns: readonly ReviewNote[]) => {
      triaged.push(ns.map((n) => n.id))
      return new Map(Object.entries(opts.verdicts ?? {}))
    },
    answerQuestions: async () => {},
    fixNits: async () => {},
    defer: async () => {},
    close: async () => {},
    captures: {
      edits: () => "edits",
      notes: () => "notes",
      editNotes: () => "editNotes",
    },
    refusals: {
      deleted: "deleted",
      unmatched: "unmatched",
      dropped: (r: Requested) => {
        dropped.push(r)
        return "dropped"
      },
    },
  } as unknown as ReviewPolicy
  const result = await review("base", p).catch((e: Error) => e)
  return { result, triaged, dropped }
}

describe("a one-shot footnote is a note, a thread footnote is not", () => {
  const base = doc(`${POINTER}[^t]`, "", thread("H: why?"))
  const replied = doc(`${POINTER}[^t]`, "", thread("H: why?", "A: because"))

  it("a one-shot footnote added after an in-gate collecting turn routes through triage", async () => {
    const withFootnote = doc(
      `${POINTER}[^t][^n1]`,
      "",
      thread("H: why?", "A: because"),
      "",
      oneShot("n1", "please rename this"),
    )
    const r = await driveRound(base, withFootnote, {
      inGate: replied,
      verdicts: { "note-1": "praise" },
    })
    expect(r.triaged).toHaveLength(1)
    expect(r.triaged[0]).toHaveLength(1)
  })

  it("only a thread reply after an in-gate collecting turn still settles", async () => {
    const r = await driveRound(base, replied, { inGate: replied })
    expect(r.triaged).toEqual([])
    expect(r.result).toEqual({ verdict: "signoff" })
  })
})

describe("the dropped refusal lists edit notes only", () => {
  const before = doc(POINTER, "- [ ] ./a.ts#2-2 other")
  const after = doc(`${POINTER} nice`, "- [ ] ./a.ts#2-2 other rename it")

  it("a hand-edit round names the edited paths and no notes", async () => {
    const r = await driveRound(before, after, { handEdit: true, silent: true })
    expect(r.result).toBeInstanceOf(Error)
    expect(r.dropped).toEqual([{ notes: [], paths: ["a.ts"] }])
  })

  it("a notes-only round names the notes judged edit, footnotes included", async () => {
    const praise = doc(
      `${POINTER}[^n1]`,
      "- [ ] ./a.ts#2-2 other[^n2]",
      "",
      oneShot("n1", "lovely"),
      "",
      oneShot("n2", "rename it"),
    )
    const r = await driveRound(before, praise, {
      verdicts: { "note-1": "praise", "note-2": "edit" },
      silent: true,
    })
    expect(r.result).toBeInstanceOf(Error)
    expect(r.triaged[0]).toHaveLength(2)
    expect(r.dropped).toHaveLength(1)
    expect(r.dropped[0]!.paths).toEqual([])
    expect(r.dropped[0]!.notes).toHaveLength(1)
    expect(r.dropped[0]!.notes[0]!.anchor).toContain("[^n2]")
  })
})

describe("reviewToHandOff", () => {
  it("hands off a footnote-only edit instead of closing as a sign-off", async () => {
    const before = doc(POINTER)
    const after = doc(`${POINTER}[^n1]`, "", oneShot("n1", "rename it"))
    const calls: string[] = []
    let awaits = 0
    const p = {
      file: "r.md",
      reviewing: async () => void (state.files["r.md"] = before),
      fixRisks: async () => {},
      keepGreen: async () => {},
      awaitReview: async () => {
        if (++awaits > 1) throw new Error("stop")
        state.files["r.md"] = after
        state.since = [{ path: "r.md", status: "modified", before, after }]
      },
      reviewMissing: async () => {},
      close: async () => void calls.push("close"),
      handOff: async () => void calls.push("handOff"),
      deleted: "deleted",
      threadsPending: "pending",
      unparsed: "unparsed",
    } as unknown as HandOffPolicy
    await reviewToHandOff("base", p)
    expect(calls).toEqual(["handOff"])
  })
})
