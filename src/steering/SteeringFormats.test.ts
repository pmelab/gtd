import { describe, expect, it } from "vitest"
import {
  applySteeringEdits,
  BUILT_IN_MODE_NAMES,
  parseFootnotes,
  parseThreads,
  steeringFormatFor,
} from "./index.js"

const QA_FORMAT = steeringFormatFor("qa")!
const REVIEW_FORMAT = steeringFormatFor("review")!

describe("BUILT_IN_MODE_NAMES", () => {
  it("lists the two built-in format names", () => {
    expect(BUILT_IN_MODE_NAMES).toEqual(["qa", "review"])
  })
})

describe("steeringFormatFor", () => {
  it("resolves 'qa' and 'review' to their singleton formats", () => {
    expect(steeringFormatFor("qa")).toBe(QA_FORMAT)
    expect(steeringFormatFor("review")).toBe(REVIEW_FORMAT)
  })

  it("resolves an unknown name to undefined", () => {
    expect(steeringFormatFor("prose")).toBeUndefined()
    expect(steeringFormatFor("adr")).toBeUndefined()
  })
})

describe("every registry entry's sample", () => {
  // Load-bearing, not a nicety (see the package's own doc comment on this
  // acceptance criterion): `src/emit/ModeContradiction.ts` round-trips this exact
  // sample through a mode's declared `format:` command, then re-validates it
  // — a sample that doesn't validate clean to begin with would hard-stop
  // every prompt beat that declares `file:`+`mode:`, at 3 wasted agent turns
  // each, with no way to tell a real contradiction from a drifted fixture.
  it("validates clean under its own format's parser", () => {
    for (const mode of BUILT_IN_MODE_NAMES) {
      const format = steeringFormatFor(mode)!
      expect(format.validate(format.sample)).toEqual([])
    }
  })
})

describe("every registry entry declares apply", () => {
  it("has a function-typed apply member, not just annotate", () => {
    for (const mode of BUILT_IN_MODE_NAMES) {
      const format = steeringFormatFor(mode)!
      expect(typeof format.apply).toBe("function")
    }
  })
})

/** Every `SteeringAnchor` embedded anywhere in `view` — walks whatever shape `view` returns without switching on `kind`, mirroring the server's own "never switch on the mode name" discipline. */
const anchorsIn = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value.flatMap(anchorsIn)
  if (value === null || typeof value !== "object") return []
  const record = value as Record<string, unknown>
  const found: unknown[] = []
  for (const [key, val] of Object.entries(record)) {
    if (key === "anchor") found.push(val)
    else found.push(...anchorsIn(val))
  }
  return found
}

describe("every registry entry's view", () => {
  it("parses `format.sample` without throwing", () => {
    for (const mode of BUILT_IN_MODE_NAMES) {
      const format = steeringFormatFor(mode)!
      expect(() => format.view(format.sample)).not.toThrow()
    }
  })

  // `format.sample` itself, derived from the registry entry alone — never a
  // per-mode fixture table (a third registry entry with no matching key
  // there would fail on a confusing `undefined`, not on the property under
  // test). `format.sample` already carries a note attached at ONE of its own
  // anchors (T7 requires a server-written note in the sample) — annotating
  // that SAME anchor again now EDITS the existing note in place
  // (`Footnotes.ts#footnoteAttachEdits`'s same-anchor update path, T6: "offers
  // editing it, not a second note"), which this treats as a PASS (`ok: true`)
  // same as any other anchor; a genuine `id-collision` (an unrelated anchor's
  // derived id colliding with existing content) remains an acceptable refusal
  // too. Only `anchor-not-found` — the anchor itself failing to resolve — is
  // the failure this property actually guards against.
  it("every anchor `view` reports is one `annotate` accepts (or correctly refuses only as an id-collision, never as anchor-not-found)", () => {
    for (const mode of BUILT_IN_MODE_NAMES) {
      const format = steeringFormatFor(mode)!
      const content = format.sample
      const view = format.view(content)
      const anchors = anchorsIn(view)
      expect(anchors.length).toBeGreaterThan(0)
      for (const anchor of anchors) {
        const result = format.annotate(content, anchor as never, "a note a human typed")
        const acceptable = result.ok || (!result.ok && result.reason === "id-collision")
        expect(
          acceptable,
          `${mode}: ${JSON.stringify(anchor)} was refused: ${JSON.stringify(result)}`,
        ).toBe(true)
      }
    }
  })
})

describe("'gtd: add a footnote' refuses where a marker would corrupt a footnote", () => {
  it("qa: refuses the action with the cursor inside an existing marker's [^name] span, rather than nesting a new marker into it", () => {
    const cursor = { line: 6, character: 19 } // "- [ ] Option A[^fn1]" — between the name and its "]"
    const action = QA_FORMAT.actions(QA_FORMAT.sample, { start: cursor, end: cursor }).find(
      (a) => a.title === "gtd: add a footnote",
    )
    expect(action).toBeUndefined()
  })

  it("qa: refuses the action with the cursor on an existing definition's own label line, rather than splitting it", () => {
    const cursor = { line: 23, character: 6 } // "[^fn1]:" — the definition's own label line
    const action = QA_FORMAT.actions(QA_FORMAT.sample, { start: cursor, end: cursor }).find(
      (a) => a.title === "gtd: add a footnote",
    )
    expect(action).toBeUndefined()
  })
})

describe("each built-in format's canonical sample (T7: writing into a live worktree)", () => {
  it("contains a note attached the way the server attaches one — a distinct `na`-prefixed id, from `Footnotes.ts#footnoteAttachEdits`", () => {
    for (const mode of BUILT_IN_MODE_NAMES) {
      const format = steeringFormatFor(mode)!
      const { definitions } = parseFootnotes(format.sample)
      expect(definitions.some((d) => /^na[0-9a-z]+$/.test(d.name))).toBe(true)
    }
  })
})

describe("thread-aware attach validates clean under every built-in format", () => {
  const FIRST = "first"
  for (const mode of BUILT_IN_MODE_NAMES) {
    it(`${mode}: new thread, reply to an open thread, edit a waiting thread`, () => {
      const format = steeringFormatFor(mode)!
      const anchors = anchorsIn(format.view(format.sample))
      const anchor = anchors.find((a) => {
        const r = format.annotate(format.sample, a as never, FIRST)
        return r.ok && parseThreads(applySteeringEdits(format.sample, r.edits)).length > 0
      })!
      const attach = (content: string, text: string): string => {
        const r = format.annotate(content, anchor as never, text)
        if (!r.ok) throw new Error("annotate refused")
        return applySteeringEdits(content, r.edits)
      }
      const created = attach(format.sample, FIRST)
      expect(format.validate(created)).toEqual([])
      const edited = attach(created, "second")
      expect(format.validate(edited)).toEqual([])
      const thread = parseThreads(edited).find((t) => t.entries[0]?.text === "second")!
      expect(thread.entries).toHaveLength(1)
      const open = edited.replace(new RegExp(`(\\n    - H: second)`), "$1\n    - A: why?")
      const replied = attach(open, "because")
      expect(format.validate(replied)).toEqual([])
      const after = parseThreads(replied).find((t) => t.name === thread.name)!
      expect(after.entries.map((e) => e.text)).toEqual(["second", "why?", "because"])
    })
  }
})
