import type { Meta, StoryObj } from "@storybook/react-vite"
import { viewport } from "../testing/browserContext.js"
import { useState } from "react"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import type { DiffResult } from "../../ui/index.js"
import type { SteeringViewNode } from "../../steering/index.js"
import { Hunk } from "./Hunk.js"

const meta: Meta<typeof Hunk> = {
  component: Hunk,
}

export default meta

const hunkNode = (over: Partial<SteeringViewNode> = {}): SteeringViewNode => ({
  title: "src/x.ts#3",
  path: "src/x.ts",
  line: 3,
  checked: false,
  anchor: { kind: "hunk", chunkIndex: 0, index: 0 },
  ...over,
})

const RESOLVED_DIFF: DiffResult = {
  kind: "hunk",
  diff: { path: "src/x.ts", hunks: [] },
  hunks: [
    {
      header: "@@ -1,3 +1,3 @@",
      newStart: 1,
      newLines: 3,
      lines: ["  const value = 1", "-const old = 2", "+const value2 = 2"],
    },
  ],
}

const WHOLE_FILE_DIFF: DiffResult = {
  kind: "whole-file",
  reason: "no-hunk-match",
  diff: {
    path: "src/moved.ts",
    hunks: [
      {
        header: "@@ -1,2 +1,2 @@",
        newStart: 1,
        newLines: 2,
        lines: ["  const a = 1", "+const b = 2"],
      },
    ],
  },
}

/** Two NON-CONTIGUOUS hunks — the whole-file fallback's own worst case: without a header line between them, the two bodies read as one continuous, misleading block. */
const TWO_HUNK_WHOLE_FILE_DIFF: DiffResult = {
  kind: "whole-file",
  reason: "no-hunk-match",
  diff: {
    path: "src/moved.ts",
    hunks: [
      {
        header: "@@ -1,2 +1,2 @@",
        newStart: 1,
        newLines: 2,
        lines: ["  const a = 1", "+const b = 2"],
      },
      {
        header: "@@ -10,1 +10,2 @@",
        newStart: 10,
        newLines: 2,
        lines: ["  const c = 3", "+const d = 4"],
      },
    ],
  },
}

const REFUSED_DIFF: DiffResult = { kind: "refused", detail: "gtd base refused (exit 1)" }

const BINARY_DIFF: DiffResult = { kind: "binary" }

/** A stateful wrapper so play functions can drive `checked`/`hasNote`/an approve counter without needing Storybook's own arg-update machinery — mirrors `Plan.stories.tsx`'s `RewritablePlan`. */
const TickableHunk = ({
  diff,
  total = 3,
  index = 1,
}: {
  diff: DiffResult
  total?: number
  index?: number
}) => {
  const [checked, setChecked] = useState(false)
  const [approveCount, setApproveCount] = useState(0)
  const [hasNote, setHasNote] = useState(false)
  return (
    <div>
      <div data-testid="approve-count">{approveCount}</div>
      <Hunk
        node={hunkNode({ checked })}
        diff={diff}
        index={index}
        total={total}
        checked={checked}
        hasNote={hasNote}
        onToggle={setChecked}
        onApprove={() => setApproveCount((c) => c + 1)}
        onOpenNote={() => setHasNote(true)}
      />
    </div>
  )
}

type Story = StoryObj<typeof Hunk>

export const ProgressThroughTheDeckIsVisibleWithoutLeavingTheScreen: StoryObj<typeof TickableHunk> =
  {
    render: () => <TickableHunk diff={RESOLVED_DIFF} index={1} total={5} />,
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement)
      await expect(canvas.getByTestId("hunk-progress")).toHaveTextContent("Hunk 2 / 5")
      await expect(canvas.getByTestId("hunk-screen")).toBeInTheDocument()
    },
  }

export const TickingApprovesAndTheTickIsTheApprovalGesture: StoryObj<typeof TickableHunk> = {
  render: () => <TickableHunk diff={RESOLVED_DIFF} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("approve-count")).toHaveTextContent("0")
    await fireEvent.click(canvas.getByTestId("hunk-tick"))
    await expect(canvas.getByTestId("hunk-tick")).toBeChecked()
    await expect(canvas.getByTestId("approve-count")).toHaveTextContent("1")
  },
}

export const UntickingDoesNotApprove: StoryObj<typeof TickableHunk> = {
  render: () => <TickableHunk diff={RESOLVED_DIFF} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("hunk-tick"))
    await expect(canvas.getByTestId("approve-count")).toHaveTextContent("1")
    await fireEvent.click(canvas.getByTestId("hunk-tick"))
    await expect(canvas.getByTestId("hunk-tick")).not.toBeChecked()
    await expect(canvas.getByTestId("approve-count")).toHaveTextContent("1")
  },
}

export const NoteAffordanceOpensTheNoteSheet: StoryObj<typeof TickableHunk> = {
  render: () => <TickableHunk diff={RESOLVED_DIFF} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("hunk-note-affordance")).toHaveTextContent("Add note")
    await fireEvent.click(canvas.getByTestId("hunk-note-affordance"))
    await expect(canvas.getByTestId("hunk-note-affordance")).toHaveTextContent("Edit note")
  },
}

/** Package 02 Task 6: the note affordance switched from a bare `<button>` to `Button`'s `ghost` variant, which guarantees the 44px thumb floor — pinned on real geometry, not just a class name, mirroring `NoteSheet.stories.tsx#FooterControlsMeetThe44pxFloor`. */
export const NoteAffordanceMeetsThe44pxFloorInItsDefaultState: StoryObj<typeof TickableHunk> = {
  render: () => <TickableHunk diff={RESOLVED_DIFF} />,
  play: async ({ canvasElement }) => {
    await viewport(390, 844)
    const canvas = within(canvasElement)
    const button = canvas.getByTestId("hunk-note-affordance")
    const rect = button.getBoundingClientRect()
    expect(rect.height).toBeGreaterThanOrEqual(44)
    expect(rect.width).toBeGreaterThanOrEqual(44)
  },
}

/** Spec feedback: `hunk-tick`'s native `<input type="checkbox">` sits inside a `<label>` sized to the 44px floor — the label (the actual tap target), not the raw input, is what's measured. */
export const HunkTickRowMeetsThe44pxFloor: StoryObj<typeof TickableHunk> = {
  render: () => <TickableHunk diff={RESOLVED_DIFF} />,
  play: async ({ canvasElement }) => {
    await viewport(390, 844)
    const canvas = within(canvasElement)
    const input = canvas.getByTestId("hunk-tick")
    const label = input.closest("label")
    expect(label).not.toBeNull()
    const rect = label!.getBoundingClientRect()
    expect(rect.height).toBeGreaterThanOrEqual(44)
    expect(rect.width).toBeGreaterThanOrEqual(44)
  },
}

/**
 * The `ghost` variant's pressed state lives entirely behind a real CSS
 * `:active` pseudo-class (`Button.tsx`'s `active:bg-surface`) — Chromium only
 * ever applies `:active` to a trusted, OS-level mouse press, so a
 * script-dispatched `mousedown` (the only kind reachable from this test
 * runner) never triggers it, and there is no reliable way to assert the
 * pressed PAINT here without a real pointer. What IS reliably assertable:
 * the ghost variant's class actually lands on the rendered button, so a
 * regression that dropped `variant="ghost"` (falling back to the default
 * `secondary` variant, which paints a border and surface background even at
 * rest) would fail this. `Hunk`'s own interface never wires a `disabled`
 * state to this button either (`onOpenNote` always fires) — there is no
 * disabled story to add here.
 */
export const NoteAffordanceUsesTheGhostVariantAtRest: StoryObj<typeof TickableHunk> = {
  render: () => <TickableHunk diff={RESOLVED_DIFF} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByTestId("hunk-note-affordance") as HTMLButtonElement
    expect(button.className).toMatch(/\bactive:bg-surface\b/)
    expect(getComputedStyle(button).backgroundColor).toBe("rgba(0, 0, 0, 0)")
  },
}

/** An unresolved pointer — `DiffResult.kind === "whole-file"` — renders that path's whole diff behind a banner saying the pointer did not resolve, per T3's own acceptance bullet, rather than an empty deck. */
export const UnresolvedPointerShowsWholeFileBehindABanner: Story = {
  args: {
    node: hunkNode({ title: "src/moved.ts (stale pointer)" }),
    diff: WHOLE_FILE_DIFF,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("hunk-diff-banner")).toHaveTextContent(
      "did not resolve to a specific hunk",
    )
    await expect(canvas.getByTestId("diff-line-0")).toBeInTheDocument()
  },
}

/** Two non-contiguous hunks in the whole-file fallback must show a `@@` header between them — never the two bodies concatenated with no gap marker, which would read as one continuous (and misleading) block. */
export const WholeFileFallbackShowsAHeaderBetweenNonContiguousHunks: Story = {
  args: {
    node: hunkNode({ title: "src/moved.ts (stale pointer)" }),
    diff: TWO_HUNK_WHOLE_FILE_DIFF,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Line 0: first hunk's own header, rendered unhighlighted (T8).
    await expect(canvas.getByTestId("diff-line-0")).toHaveAttribute("data-kind", "header")
    await expect(canvas.getByTestId("diff-line-0")).toHaveTextContent("@@ -1,2 +1,2 @@")
    // Lines 1-2: first hunk's own body.
    await expect(canvas.getByTestId("diff-line-2")).toHaveTextContent("const b = 2")
    // Line 3: SECOND hunk's own header — the gap marker between the two
    // non-contiguous regions, not a silent jump straight into its body.
    await expect(canvas.getByTestId("diff-line-3")).toHaveAttribute("data-kind", "header")
    await expect(canvas.getByTestId("diff-line-3")).toHaveTextContent("@@ -10,1 +10,2 @@")
    await expect(canvas.getByTestId("diff-line-5")).toHaveTextContent("const d = 4")
  },
}

/** T4: a hunk's own description (the author's prose, carried on `node.detail`) renders as read-only context between the title and the diff — never in the note textbox, which starts empty unless a human actually attached one. */
export const DescriptionRendersBetweenTitleAndDiff: Story = {
  args: {
    node: hunkNode({ detail: "adds the retry loop" }),
    diff: RESOLVED_DIFF,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByText("src/x.ts#3")
    const description = canvas.getByTestId("hunk-description")
    const diff = canvas.getByTestId("diff-line-0")
    await expect(description).toHaveTextContent("adds the retry loop")
    // Between title and diff: title's DOM position precedes the
    // description's, which in turn precedes the diff's.
    expect(
      title.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      description.compareDocumentPosition(diff) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  },
}

/**
 * Package 02, T4/T8: a description carrying `**bold**`, `` `code` ``,
 * `~~strike~~` and a link renders real `<strong>`, `<code>`, `<s>` and `<a>`
 * elements, with no marker character left in the row's own text content —
 * the shared `InlineRun` renderer, not the deleted `LINK_RE` regex.
 */
export const DescriptionInlineMarkdownRendersAsRealElements: Story = {
  args: {
    node: hunkNode({
      detail: "adds bold code strike and a link",
      detailInline: [
        { kind: "text", value: "adds " },
        { kind: "strong", children: [{ kind: "text", value: "bold" }] },
        { kind: "text", value: " " },
        { kind: "code", value: "code" },
        { kind: "text", value: " " },
        { kind: "delete", children: [{ kind: "text", value: "strike" }] },
        { kind: "text", value: " and a " },
        {
          kind: "link",
          href: "https://example.com",
          children: [{ kind: "text", value: "link" }],
        },
      ],
    }),
    diff: RESOLVED_DIFF,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const description = canvas.getByTestId("hunk-description")
    expect(description.querySelector("strong")).toHaveTextContent("bold")
    expect(description.querySelector("code")).toHaveTextContent("code")
    expect(description.querySelector("s")).toHaveTextContent("strike")
    const link = description.querySelector("a")
    expect(link).toHaveTextContent("link")
    expect(link).toHaveAttribute("href", "https://example.com")
    expect(description.textContent).not.toContain("**")
    expect(description.textContent).not.toContain("~~")
    expect(description.textContent).not.toContain("`")
  },
}

/** No description at all renders nothing in that slot — no placeholder element, one rule with the chunk level (`Review.tsx`'s `chunk.detail` guard). */
export const NoDescriptionRendersNoPlaceholder: Story = {
  args: {
    node: hunkNode(),
    diff: RESOLVED_DIFF,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByTestId("hunk-description")).not.toBeInTheDocument()
  },
}

/** A hunk carrying only a description (no attached note) shows "Add note" — the note affordance reads `hasNote`, which the description must never seed. */
export const DescriptionOnlyHunkStillReadsAddNote: Story = {
  args: {
    node: hunkNode({ detail: "adds the retry loop" }),
    diff: RESOLVED_DIFF,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("hunk-note-affordance")).toHaveTextContent("Add note")
  },
}

export const RefusedDiffShowsItsDetail: Story = {
  args: {
    node: hunkNode(),
    diff: REFUSED_DIFF,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("hunk-diff-banner")).toHaveTextContent("gtd base refused")
  },
}

export const BinaryFileRendersAPlaceholder: Story = {
  args: {
    node: hunkNode(),
    diff: BINARY_DIFF,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("hunk-diff-binary")).toBeInTheDocument()
  },
}

/** A stale/renamed/moved pointer at a path with NOTHING in the review range at all gets its own stated placeholder — never `whole-file`'s "did not resolve to a specific hunk" banner painted over a blank body, which is what this shape used to fall into before `DiffResult` gained its own `no-changes` kind. */
export const PathWithNoChangesInTheRangeRendersItsOwnPlaceholder: Story = {
  args: {
    node: hunkNode(),
    diff: { kind: "no-changes" } satisfies DiffResult,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("hunk-diff-no-changes")).toHaveTextContent(
      "no changes in the review range",
    )
    await expect(canvas.queryByTestId("hunk-diff-banner")).not.toBeInTheDocument()
  },
}

/** Proves tokens are ACTUALLY painted, not just classified: a keyword (`const`) and plain text in the same line must render with visibly different colors — a `className` with no matching CSS anywhere would leave every token the same inherited color and fail this. */
export const KeywordTokensAreVisiblyColoredDifferentlyFromPlainText: Story = {
  args: {
    node: hunkNode(),
    diff: RESOLVED_DIFF,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Line 0 is now the hunk's own `@@` header (T1: every hunk renders one) —
    // line 1 is the first body line.
    const line = canvas.getByTestId("diff-line-1")
    const keywordSpan = within(line).getByText("const")
    const plainSpan = within(line).getByText("value", { exact: false })
    expect(keywordSpan.getAttribute("data-token-kind")).toBe("kw")
    const keywordColor = getComputedStyle(keywordSpan).color
    const plainColor = getComputedStyle(plainSpan).color
    expect(keywordColor).not.toBe("")
    expect(keywordColor).not.toBe(plainColor)
  },
}

/**
 * T8's "added, removed and context lines are visually distinguishable" is
 * about actual PAINT, not the three distinct `LineKind` STRINGS
 * `Highlight.test.ts#lineKind` already covers — this asserts the three real
 * `background-color`s computed for each line kind's own row are genuinely
 * different, mirroring `KeywordTokensAreVisiblyColoredDifferentlyFromPlainText`'s
 * identical proof one layer down at the token level. Setting `LINE_BACKGROUND.add`
 * to the same value as `context` would still pass every OTHER test in the
 * repo; only this one paints and measures the actual pixels' own color.
 */
export const AddedRemovedAndContextLinesHaveVisiblyDifferentBackgrounds: Story = {
  args: {
    node: hunkNode(),
    diff: RESOLVED_DIFF,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // RESOLVED_DIFF's own lines: 0 is the hunk's `@@` header (T1), 1 is
    // context ("  const value = 1"), 2 is del ("-const old = 2"), 3 is add
    // ("+const value2 = 2").
    const contextLine = canvas.getByTestId("diff-line-1")
    const delLine = canvas.getByTestId("diff-line-2")
    const addLine = canvas.getByTestId("diff-line-3")
    expect(contextLine).toHaveAttribute("data-kind", "context")
    expect(delLine).toHaveAttribute("data-kind", "del")
    expect(addLine).toHaveAttribute("data-kind", "add")
    const contextColor = getComputedStyle(contextLine).backgroundColor
    const delColor = getComputedStyle(delLine).backgroundColor
    const addColor = getComputedStyle(addLine).backgroundColor
    expect(new Set([contextColor, delColor, addColor]).size).toBe(3)
  },
}

/** Git's own `\ No newline at end of file` marker line — none of the three visually-distinguishable kinds T8 names (added/removed/context), so it must reach the screen as its own kind, verbatim (no leading `\` eaten, no source line mangled into looking like context). */
export const NoNewlineMarkerRendersVerbatimNotAsContext: Story = {
  args: {
    node: hunkNode(),
    diff: {
      kind: "hunk",
      diff: { path: "src/x.ts", hunks: [] },
      hunks: [
        {
          header: "@@ -1,2 +1,2 @@",
          newStart: 1,
          newLines: 2,
          lines: ["-const old = 2", "+const value2 = 2", "\\ No newline at end of file"],
        },
      ],
    } satisfies DiffResult,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Line 0 is the hunk's own `@@` header (T1); the marker is the third body line.
    const markerLine = canvas.getByTestId("diff-line-3")
    expect(markerLine).toHaveAttribute("data-kind", "marker")
    expect(markerLine).not.toHaveAttribute("data-kind", "context")
    expect(markerLine).toHaveTextContent("\\ No newline at end of file")
  },
}

/**
 * `Highlight.test.ts`'s own escaping test only proves `highlightDiffLine`'s
 * TOKEN TEXT survives markup characters untouched — the actual safety
 * property (React renders `{token.text}` as a text node, never
 * `dangerouslySetInnerHTML`) lives in `Hunk.tsx`'s own JSX and is pinned
 * NOWHERE: swapping in `dangerouslySetInnerHTML={{__html: token.text}}`
 * there would pass every other test in the repo and is a live XSS. This
 * renders a diff line containing a real `<script>` tag and asserts the DOM
 * never actually creates one — only inert text.
 */
export const MarkupInADiffLineRendersAsInertTextNeverParsedHtml: Story = {
  args: {
    node: hunkNode(),
    diff: {
      kind: "hunk",
      diff: { path: "src/x.ts", hunks: [] },
      hunks: [
        {
          header: "@@ -1,1 +1,1 @@",
          newStart: 1,
          newLines: 1,
          lines: [`+const s = "<script>window.__xss = true</script>"`],
        },
      ],
    } satisfies DiffResult,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Line 0 is the hunk's own `@@` header (T1); the added line is line 1.
    const line = canvas.getByTestId("diff-line-1")
    // The raw markup survives in the rendered TEXT content...
    expect(line).toHaveTextContent(`const s = "<script>window.__xss = true</script>"`)
    // ...but was never actually parsed into a real <script> element, and
    // never executed either.
    expect(line.querySelector("script")).toBeNull()
    expect((window as unknown as { __xss?: boolean }).__xss).toBeUndefined()
  },
}

/**
 * A long added line scrolled horizontally must keep its green band under the
 * text all the way to the line's end: a block-level line sizes to the SCROLL
 * PORT, not to the scrollable content, so without a content-width wrapper
 * the background stops at the initial viewport edge. Pinned on real
 * geometry — each line's painted width against the scroll container's
 * `scrollWidth` — not on a class name.
 */
export const LineBackgroundsSpanTheFullScrollWidthNotJustTheViewport: Story = {
  args: {
    node: hunkNode(),
    diff: {
      kind: "hunk",
      diff: { path: "src/x.ts", hunks: [] },
      hunks: [
        {
          header: "@@ -1,2 +1,2 @@",
          newStart: 1,
          newLines: 2,
          lines: [
            "  const short = 1",
            `+const wide = "${"x".repeat(400)}"`,
            `-const gone = "${"y".repeat(400)}"`,
          ],
        },
      ],
    } satisfies DiffResult,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    await viewport(390, 844)
    const canvas = within(canvasElement)
    // Line 0 is now the hunk's own `@@` header (T1); the fixture's three body
    // lines are 1-3.
    const addLine = canvas.getByTestId("diff-line-2")
    const scroller = addLine.closest("[class*='overflow-x-auto']")
    expect(scroller).not.toBeNull()
    // The fixture really does overflow — otherwise this story would pass
    // against a viewport wide enough to hide the bug.
    expect(scroller!.scrollWidth).toBeGreaterThan(scroller!.clientWidth)
    for (const id of ["diff-line-0", "diff-line-1", "diff-line-2", "diff-line-3"]) {
      expect(canvas.getByTestId(id).getBoundingClientRect().width).toBeGreaterThanOrEqual(
        scroller!.scrollWidth - 1,
      )
    }
  },
}

/**
 * Approving is this screen's whole purpose, so its control is painted as
 * one: a bordered full-width row whose checked state is carried by the row's
 * own accent boundary and its label ("Approved"), not by the ~20px tick box
 * alone. Asserted on computed style, since the point is what a thumb sees
 * from arm's length.
 */
export const ApproveRowMarksItsCheckedStateBeyondTheTickBox: StoryObj<typeof TickableHunk> = {
  render: () => <TickableHunk diff={RESOLVED_DIFF} />,
  play: async ({ canvasElement }) => {
    await viewport(390, 844)
    const canvas = within(canvasElement)
    const row = canvas.getByTestId("hunk-approve-row")
    expect(row).toHaveTextContent("Approve this hunk")
    const restingBorder = getComputedStyle(row).borderColor
    expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)

    await fireEvent.click(canvas.getByTestId("hunk-tick"))
    expect(row).toHaveTextContent("Approved")
    // `waitFor`: the boundary colour crosses over a 150ms transition, so the
    // frame right after the click still holds the resting value.
    await waitFor(() => expect(getComputedStyle(row).borderColor).not.toBe(restingBorder))
  },
}

/**
 * A hunk that already carries a note shows the NOTE where its control was —
 * the same rule a chunk row follows on the list screen. The bare "Edit note"
 * label survives only as the fallback for a caller that knows a note exists
 * but not what it says.
 */
export const AHunksNoteTakesTheNoteControlsPlace: Story = {
  args: {
    node: hunkNode(),
    diff: RESOLVED_DIFF,
    index: 0,
    total: 1,
    checked: false,
    hasNote: true,
    note: "This drops the old value without migrating it.",
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    await viewport(390, 844)
    const canvas = within(canvasElement)
    const affordance = canvas.getByTestId("hunk-note-affordance")
    await expect(affordance).toHaveTextContent("This drops the old value without migrating it.")
    await expect(affordance).not.toHaveTextContent("Edit note")
    // Still a real tap target, and still the thing that opens the sheet.
    expect(affordance.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
  },
}

/** The fallback: `hasNote` with no text to show still reads as a control rather than rendering an empty box. */
export const AHunkKnownToCarryANoteWithoutItsTextStillReadsAsAControl: Story = {
  args: {
    node: hunkNode(),
    diff: RESOLVED_DIFF,
    index: 0,
    total: 1,
    checked: false,
    hasNote: true,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("hunk-note-affordance")).toHaveTextContent("Edit note")
  },
}

/**
 * A new-file hunk (`newStart: 1, newLines: 400`) pointed at lines 190-201 (12
 * lines). `lines`/`dimmed` here are already `Diff.ts#sliceHunk`'s OUTPUT for
 * that range — this story fixture is the client's own input, one layer
 * downstream of that slicing — so the 18-line body is exactly [187..204]:
 * three lines of dimmed pad on each side of the 12-line, never-dimmed range.
 */
const TWELVE_LINE_RANGE_IN_A_NEW_FILE: DiffResult = {
  kind: "hunk",
  diff: { path: "src/big.ts", hunks: [] },
  hunks: [
    {
      header: "@@ -0,0 +1,400 @@",
      newStart: 1,
      newLines: 400,
      lines: Array.from({ length: 18 }, (_, i) => `+line${187 + i}`),
      dimmed: Array.from({ length: 18 }, (_, i) => i < 3 || i >= 15),
    },
  ],
}

/** T4: a new-file pointer whose range covers 12 lines of a 400-line file shows 12 in-range rows plus 3 dimmed above and 3 dimmed below — never the whole 400-line body. */
export const RangeInANewFileShowsTwelveInRangeRowsWithThreeDimmedOnEachSide: Story = {
  args: {
    node: hunkNode({ title: "src/big.ts#190-201", line: 190, endLine: 201 }),
    diff: TWELVE_LINE_RANGE_IN_A_NEW_FILE,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Line 0: the hunk's own `@@` header. Lines 1-3: dimmed pad above.
    // Lines 4-15: the 12 in-range rows (never dimmed). Lines 16-18: dimmed
    // pad below. Line 19 doesn't exist — no cap, but also nothing beyond
    // the pointed range's own 3-line pad.
    await expect(canvas.getByTestId("diff-line-0")).toHaveAttribute("data-kind", "header")
    for (const i of [1, 2, 3]) {
      await expect(canvas.getByTestId(`diff-line-${i}`)).toHaveAttribute("data-dimmed", "true")
    }
    for (let i = 4; i <= 15; i++) {
      await expect(canvas.getByTestId(`diff-line-${i}`)).not.toHaveAttribute("data-dimmed")
    }
    for (const i of [16, 17, 18]) {
      await expect(canvas.getByTestId(`diff-line-${i}`)).toHaveAttribute("data-dimmed", "true")
    }
    await expect(canvas.queryByTestId("diff-line-19")).not.toBeInTheDocument()
  },
}

/** T4: a range spanning two hunks shows BOTH `@@` headers, one immediately above its own body — the same "no merged bodies" rule T1's whole-file fallback already enforces, now proven for a resolved `"hunk"` result too. */
export const RangeSpanningTwoHunksShowsBothHeaders: Story = {
  args: {
    node: hunkNode({ title: "src/x.ts#4-11", line: 4, endLine: 11 }),
    diff: {
      kind: "hunk",
      diff: { path: "src/x.ts", hunks: [] },
      hunks: [
        {
          header: "@@ -1,5 +1,5 @@",
          newStart: 1,
          newLines: 5,
          lines: [
            "  const a = 1",
            "  const b = 2",
            "  const c = 3",
            "  const d = 4",
            "  const e = 5",
          ],
        },
        {
          header: "@@ -10,6 +10,6 @@",
          newStart: 10,
          newLines: 6,
          lines: [
            "  const f = 6",
            "  const g = 7",
            "  const h = 8",
            "  const i = 9",
            "  const j = 10",
            "  const k = 11",
          ],
        },
      ],
    } satisfies DiffResult,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("diff-line-0")).toHaveTextContent("@@ -1,5 +1,5 @@")
    await expect(canvas.getByTestId("diff-line-6")).toHaveTextContent("@@ -10,6 +10,6 @@")
    await expect(canvas.getByTestId("diff-line-7")).toHaveTextContent("const f = 6")
  },
}

/** T4: a range clamped at a hunk's first line has nowhere to pad ABOVE — the first body row is the range's own first line, never a dimmed one, and never a missing `diff-line-1`. */
export const RangeClampedAtAHunksFirstLineShowsFewerThanThreeContextLinesAbove: Story = {
  args: {
    node: hunkNode({ title: "src/x.ts#1-3", line: 1, endLine: 3 }),
    diff: {
      kind: "hunk",
      diff: { path: "src/x.ts", hunks: [] },
      hunks: [
        {
          header: "@@ -1,10 +1,10 @@",
          newStart: 1,
          newLines: 10,
          lines: [
            "  const a = 1",
            "  const b = 2",
            "  const c = 3",
            "  const d = 4",
            "  const e = 5",
            "  const f = 6",
          ],
          dimmed: [false, false, false, true, true, true],
        },
      ],
    } satisfies DiffResult,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Line 0: header. Line 1: the range's own first line ("const a = 1") —
    // never dimmed, since the hunk starts exactly there. Lines 2-3: the
    // rest of the 3-line range. Lines 4-6: the (full, un-clamped) 3-line pad
    // below.
    await expect(canvas.getByTestId("diff-line-1")).not.toHaveAttribute("data-dimmed")
    await expect(canvas.getByTestId("diff-line-1")).toHaveTextContent("const a = 1")
    for (const i of [4, 5, 6]) {
      await expect(canvas.getByTestId(`diff-line-${i}`)).toHaveAttribute("data-dimmed", "true")
    }
  },
}

/**
 * T4's "both light and dark themes" bullet: this client ships exactly one
 * theme (`styles.css`'s own `@theme` block is labelled "Dark-only palette"
 * at its top, and nothing in `src/web` reads `prefers-color-scheme` or a
 * `data-theme` attribute) — so this is that one theme's own dimmed-band
 * story, standing in for both until a second theme exists to actually
 * switch between. What it proves regardless of theme count: a dimmed row's
 * TEXT renders at reduced opacity while an in-range row's does not, and
 * neither row's own background changes.
 */
export const DimmedContextBandRendersInTheShippedTheme: Story = {
  args: {
    node: hunkNode({ title: "src/big.ts#190-201", line: 190, endLine: 201 }),
    diff: TWELVE_LINE_RANGE_IN_A_NEW_FILE,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const dimmedRow = canvas.getByTestId("diff-line-1")
    const inRangeRow = canvas.getByTestId("diff-line-4")
    const dimmedOpacity = Number(getComputedStyle(dimmedRow.querySelector("span")!).opacity)
    const inRangeOpacity = Number(getComputedStyle(inRangeRow.querySelector("span")!).opacity)
    expect(dimmedOpacity).toBeLessThan(1)
    expect(inRangeOpacity).toBe(1)
    // Backgrounds stay identical — both rows are `add` kind (T3: opacity on
    // the foreground only, never a new background).
    expect(getComputedStyle(dimmedRow).backgroundColor).toBe(
      getComputedStyle(inRangeRow).backgroundColor,
    )
    // Spec feedback: opacity alone (a ~1.4:1 difference at the shipped
    // 0.85, under WCAG's own 3:1 non-text-distinction floor) is not a
    // glanceable boundary — `dimmedOpacity < 1` alone would still pass at
    // 0.999. The left border rule is the PRIMARY cue this pins: a real,
    // non-transparent colour on the dimmed row and NO border at all
    // (transparent, zero-alpha) on the in-range row, painted, not just
    // classed.
    const dimmedBorder = getComputedStyle(dimmedRow).borderLeftColor
    const inRangeBorder = getComputedStyle(inRangeRow).borderLeftColor
    expect(getComputedStyle(dimmedRow).borderLeftWidth).toBe("2px")
    expect(dimmedBorder).not.toBe("rgba(0, 0, 0, 0)")
    expect(inRangeBorder).toBe("rgba(0, 0, 0, 0)")
    expect(dimmedBorder).not.toBe(inRangeBorder)
  },
}

/** T1's own explicit bullet: "No cap on screen length" — a 900-line range renders 900 rows, verbatim, never a truncation marker or a "show more" control. `line`/`endLine` cover the WHOLE hunk, so nothing is dimmed; this story is about length alone. */
export const A900LineRangeRendersAll900RowsWithNoTruncationMarker: Story = {
  args: {
    node: hunkNode({ title: "src/huge.ts#1-900", line: 1, endLine: 900 }),
    diff: {
      kind: "hunk",
      diff: { path: "src/huge.ts", hunks: [] },
      hunks: [
        {
          header: "@@ -0,0 +1,900 @@",
          newStart: 1,
          newLines: 900,
          lines: Array.from({ length: 900 }, (_, i) => `+line${i + 1}`),
        },
      ],
    } satisfies DiffResult,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Line 0: the hunk's own header. Lines 1-900: every body row, none
    // dimmed (the range covers the whole hunk) and none missing.
    await expect(canvas.getByTestId("diff-line-1")).toHaveTextContent("line1")
    await expect(canvas.getByTestId("diff-line-900")).toHaveTextContent("line900")
    await expect(canvas.getByTestId("diff-line-900")).not.toHaveAttribute("data-dimmed")
    await expect(canvas.queryByTestId("diff-line-901")).not.toBeInTheDocument()
    // No truncation affordance of any kind — the spec forbids one outright.
    expect(canvas.queryByText(/show more/i)).not.toBeInTheDocument()
    expect(canvas.queryByText(/\.\.\./)).not.toBeInTheDocument()
  },
}

/**
 * `Diff.ts#sliceHunk`'s own OUTPUT for a range with a deletion inside it AND
 * a deletion in each pad band — mirrors `Diff.test.ts#contextHunkWithDeletionAt10`'s
 * shape, computed by hand against `sliceHunk`'s real algorithm (`Diff.ts` is
 * outside this package's `Paths`, so this fixture is pre-sliced, the same as
 * `TWELVE_LINE_RANGE_IN_A_NEW_FILE` above). Source hunk: 20 context lines
 * (`newStart: 1, newLines: 20`) with `-delAbove` spliced in right before post-
 * image line 7, `-delInside` right before line 11, `-delBelow` right before
 * line 14. Range `[10, 12]` → window `[7, 15]`, giving exactly this 12-line
 * slice: `-delAbove`, 7-9, `line10`, `-delInside`, 11-13, `-delBelow`, 14-15.
 */
const RANGE_WITH_DELETIONS_INSIDE_AND_IN_THE_PAD_BAND: DiffResult = {
  kind: "hunk",
  diff: { path: "src/x.ts", hunks: [] },
  hunks: [
    {
      header: "@@ -1,21 +1,20 @@",
      newStart: 1,
      newLines: 20,
      lines: [
        "-delAbove",
        " line7",
        " line8",
        " line9",
        " line10",
        "-delInside",
        " line11",
        " line12",
        " line13",
        "-delBelow",
        " line14",
        " line15",
      ],
      dimmed: [true, true, true, true, false, false, false, false, true, true, true, true],
    },
  ],
}

/**
 * `sliceHunk`'s own `dimmed` array, for a `-` line on both sides of the
 * dimmed/in-range boundary (the `Math.min(postImageLine, hunkEnd)` clamp, "a
 * deleted line sits at the number it does not advance past") — every OTHER
 * dimmed-band story only ever exercises its `+`/` ` branch. `-delAbove` (pad
 * band, dimmed), `-delInside` (inside the range, never dimmed) and
 * `-delBelow` (pad band, dimmed) — so a future edit that shifts that clamp
 * by one line fails here even though every `+`/` `-only fixture would still
 * pass.
 */
export const DeletionsInsideTheRangeAndInThePadBandAreFlaggedCorrectly: Story = {
  args: {
    node: hunkNode({ title: "src/x.ts#10-12", line: 10, endLine: 12 }),
    diff: RANGE_WITH_DELETIONS_INSIDE_AND_IN_THE_PAD_BAND,
    index: 0,
    total: 1,
    checked: false,
    hasNote: false,
    onToggle: () => {},
    onApprove: () => {},
    onOpenNote: () => {},
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Line 0: header. Line 1: `-delAbove`, in the pad band above the range
    // — dimmed, even though it's a `-` line, not a ` ` one.
    const delAbove = canvas.getByTestId("diff-line-1")
    await expect(delAbove).toHaveTextContent("delAbove")
    await expect(delAbove).toHaveAttribute("data-kind", "del")
    await expect(delAbove).toHaveAttribute("data-dimmed", "true")
    // Lines 2-4 (line7-line9): pad-band context, also dimmed.
    for (const i of [2, 3, 4]) {
      await expect(canvas.getByTestId(`diff-line-${i}`)).toHaveAttribute("data-dimmed", "true")
    }
    // Line 5 (line10): the range's own first line — never dimmed.
    await expect(canvas.getByTestId("diff-line-5")).not.toHaveAttribute("data-dimmed")
    // Line 6: `-delInside`, inside the range — never dimmed, despite being
    // a `-` line right next to two dimmed ones.
    const delInside = canvas.getByTestId("diff-line-6")
    await expect(delInside).toHaveTextContent("delInside")
    await expect(delInside).toHaveAttribute("data-kind", "del")
    await expect(delInside).not.toHaveAttribute("data-dimmed")
    // Lines 7-8 (line11-line12): the rest of the range — never dimmed.
    for (const i of [7, 8]) {
      await expect(canvas.getByTestId(`diff-line-${i}`)).not.toHaveAttribute("data-dimmed")
    }
    // Line 9 (line13): pad band below — dimmed.
    await expect(canvas.getByTestId("diff-line-9")).toHaveAttribute("data-dimmed", "true")
    // Line 10: `-delBelow`, pad band below — dimmed.
    const delBelow = canvas.getByTestId("diff-line-10")
    await expect(delBelow).toHaveTextContent("delBelow")
    await expect(delBelow).toHaveAttribute("data-kind", "del")
    await expect(delBelow).toHaveAttribute("data-dimmed", "true")
    // Lines 11-12 (line14-line15): pad band below — dimmed.
    for (const i of [11, 12]) {
      await expect(canvas.getByTestId(`diff-line-${i}`)).toHaveAttribute("data-dimmed", "true")
    }
  },
}
