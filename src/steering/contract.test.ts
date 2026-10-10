/// <reference types="vite/client" />
import { describe, expect, it } from "vitest"
import {
  applySteeringEdits,
  freeFormFormat,
  parseCodeThreads,
  parseFootnotes,
  parseThreads,
  reviewNotes,
  reviewRisks,
  steeringFormatFor,
  stripCodeThreads,
  type SteeringAnchor,
  type SteeringFormat,
  type SteeringViewNode,
} from "./index.js"

// The format contract (see FORMATS.md). Fixtures are files steering already
// reads; a change that makes one of these fail stops older committed files
// from being read the same way. Loaded by the bundler, so steering stays
// free of filesystem access even in its tests.
const FIXTURES = import.meta.glob<string>("./fixtures/**/*", {
  query: "?raw",
  import: "default",
  eager: true,
})

const fixture = (path: string): string => {
  const content = FIXTURES[`./fixtures/${path}`]
  if (content === undefined) throw new Error(`no fixture ${path}`)
  return content
}

const FORMATS: readonly (readonly [dir: string, format: SteeringFormat, ticks: boolean])[] = [
  ["qa", steeringFormatFor("qa")!, true],
  ["review", steeringFormatFor("review")!, true],
  ["free-form", freeFormFormat, false],
]

const nodesOf = (nodes: readonly SteeringViewNode[]): readonly SteeringViewNode[] =>
  nodes.flatMap((n) => [n, ...nodesOf(n.children ?? []), ...nodesOf(n.body ?? [])])

// Presentation-only fields: how a node is rendered, not what the file says.
const PRESENTATION = new Set(["block", "inline", "detailInline"])

/** What `view` reads out of a file, minus presentation — pinned by `<fixture>.read.json`. */
const readOf = (format: SteeringFormat, content: string): unknown =>
  JSON.parse(
    JSON.stringify(format.view(content), (key, value: unknown) =>
      PRESENTATION.has(key) ? undefined : value,
    ),
  )

/** Every note the document carries: thread entries and one-shot footnote bodies. */
const notesIn = (content: string): readonly string[] => [
  ...parseThreads(content).flatMap((t) => t.entries.map((e) => e.text)),
  ...parseFootnotes(content).definitions.map((d) => d.body),
]

const write = (
  content: string,
  result: ReturnType<SteeringFormat["apply"]>,
  what: string,
): string => {
  if (!result.ok) throw new Error(`${what} refused: ${result.reason}`)
  return applySteeringEdits(content, result.edits)
}

describe.each(FORMATS)("the %s format", (dir, format, ticks) => {
  const files = Object.keys(FIXTURES)
    .map((key) => key.slice("./fixtures/".length))
    .filter((path) => path.startsWith(`${dir}/`) && path.endsWith(".md"))

  it("has fixtures", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it(ticks ? "has a fixture with a ticked box" : "has no ticks to read", () => {
    const ticked = files.some((path) =>
      nodesOf(format.view(fixture(path)).nodes).some((n) => n.checked),
    )
    expect(ticked).toBe(ticks)
  })

  describe.each(files)("%s", (path) => {
    const content = fixture(path)

    it("reads clean", () => {
      expect(format.validate(content)).toEqual([])
    })

    it("parses to its pinned read", () => {
      expect(readOf(format, content)).toEqual(
        JSON.parse(fixture(path.replace(/\.md$/, ".read.json"))),
      )
    })

    if (ticks)
      it("round-trips every tick: writing back what was read leaves the bytes unchanged", () => {
        for (const node of nodesOf(format.view(content).nodes)) {
          if (node.checked === undefined || node.anchor.kind === "chunk") continue
          const anchor: SteeringAnchor = node.anchor
          const same = write(
            content,
            format.apply(content, anchor, { checked: node.checked }),
            "same",
          )
          expect(same).toBe(content)
          if (!node.checked) continue
          const off = write(content, format.apply(content, anchor, { checked: false }), "off")
          expect(off).not.toBe(content)
          expect(write(off, format.apply(off, anchor, { checked: true }), "on")).toBe(content)
        }
      })

    it("round-trips a note at every anchor: it reads back, and the document stays clean", () => {
      const text = "A note written through the contract test."
      const anchors = nodesOf(format.view(content).nodes).map((n) => n.anchor)
      expect(anchors.length).toBeGreaterThan(0)
      for (const anchor of anchors) {
        const noted = write(content, format.annotate(content, anchor, text), JSON.stringify(anchor))
        expect(notesIn(noted), JSON.stringify(anchor)).toContain(text)
        expect(format.validate(noted), JSON.stringify(anchor)).toEqual([])
      }
    })
  })
})

describe("footnote threads, shared by every markdown format", () => {
  it.each([
    [
      "review/ticked.md",
      [
        [
          "th1",
          ["Does this also cover the writer?", "No, the writer keeps the input's line endings."],
          "human",
        ],
      ],
    ],
    [
      "qa/answered.md",
      [
        [
          "th1",
          ["Is this the git common dir?", "Yes, the directory every worktree shares."],
          "human",
        ],
      ],
    ],
    ["free-form/notes.md", [["th1", ["Should this become a plan?"], "agent"]]],
  ])("%s parses its threads", (path, expected) => {
    expect(
      parseThreads(fixture(path)).map((t) => [t.name, t.entries.map((e) => e.text), t.waitingOn]),
    ).toEqual(expected)
  })
})

describe("review notes, the review → fix hand-off", () => {
  const baseline = fixture("review-notes/baseline.md")
  const noted = fixture("review-notes/noted.md")
  const review = steeringFormatFor("review")!

  it("both sides read clean as review documents", () => {
    expect(review.validate(baseline)).toEqual([])
    expect(review.validate(noted)).toEqual([])
  })

  it("reads chunk prose, pointer and footnote notes in document order, never a thread", () => {
    expect(reviewNotes(baseline, noted)).toEqual([
      {
        id: "note-1",
        kind: "chunk",
        anchor: "Parser accepts CRLF",
        before: "**Line endings are normalized before the split.**",
        text: "**Line endings are normalized before the split.** Also normalize in the writer.",
      },
      {
        id: "note-2",
        kind: "pointer",
        anchor: "Parser accepts CRLF ./src/parse.ts#30-31",
        before: "Risk: a lone `\\r` is still kept as content",
        text: "Risk: a lone `\\r` is still kept as content. Treat it as a line break too.",
      },
      {
        id: "note-3",
        kind: "footnote",
        anchor: "- [x] ./src/parse.test.ts#1-40 — one case per line ending[^fn1]",
        before: "",
        text: "Add a mixed-endings case.",
      },
    ])
  })

  it("reads the reviewer's Risk: pointer notes", () => {
    expect(reviewRisks(baseline)).toEqual([
      {
        id: "risk-1",
        anchor: "Parser accepts CRLF ./src/parse.ts#30-31",
        text: "Risk: a lone `\\r` is still kept as content",
      },
    ])
  })

  it("an unchanged document carries no notes", () => {
    expect(reviewNotes(noted, noted)).toEqual([])
  })

  it("round-trips: a note written at a hunk reads back as a thread, never as a review note", () => {
    const text = "Rename this."
    const after = write(
      baseline,
      review.annotate(baseline, { kind: "hunk", chunkIndex: 1, index: 0 }, text),
      "annotate",
    )
    expect(reviewNotes(baseline, after)).toEqual([])
    expect(parseThreads(after).map((t) => [t.entries.map((e) => e.text), t.waitingOn])).toEqual([
      [[text], "agent"],
    ])
  })
})

describe("code threads", () => {
  const source = /```ts\n([\s\S]*?)```/.exec(fixture("code-threads/cache.ts.md"))![1]!
  const stripped = fixture("code-threads/cache.stripped.ts.txt")

  it("parses each H:/A: comment run as a thread", () => {
    expect(parseCodeThreads("cache.ts", source)).toEqual({
      threads: [
        {
          path: "cache.ts",
          line: 2,
          endLine: 4,
          entries: [
            {
              author: "me",
              text: "Why not the modification time? A checkout could keep it stable.",
              line: 2,
            },
            { author: "agent", text: "A checkout rewrites every mtime.", line: 4 },
          ],
          waitingOn: "human",
        },
        {
          path: "cache.ts",
          line: 8,
          endLine: 8,
          entries: [{ author: "me", text: "Should this honour $XDG_CACHE_HOME?", line: 8 }],
          waitingOn: "agent",
        },
      ],
      findings: [],
    })
  })

  it("strips threads and keeps ordinary comments", () => {
    expect(stripCodeThreads("cache.ts", source)).toBe(stripped)
  })

  it("round-trips: a thread-free file strips to itself", () => {
    expect(stripCodeThreads("cache.ts", stripped)).toBe(stripped)
    expect(parseCodeThreads("cache.ts", stripped).threads).toEqual([])
  })
})
