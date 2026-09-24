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
  hunk: {
    header: "@@ -1,3 +1,3 @@",
    newStart: 1,
    newLines: 3,
    lines: ["  const value = 1", "-const old = 2", "+const value2 = 2"],
  },
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
    const line = canvas.getByTestId("diff-line-0")
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
    // RESOLVED_DIFF's own lines: 0 is context ("  const value = 1"), 1 is
    // del ("-const old = 2"), 2 is add ("+const value2 = 2").
    const contextLine = canvas.getByTestId("diff-line-0")
    const delLine = canvas.getByTestId("diff-line-1")
    const addLine = canvas.getByTestId("diff-line-2")
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
      hunk: {
        header: "@@ -1,2 +1,2 @@",
        newStart: 1,
        newLines: 2,
        lines: ["-const old = 2", "+const value2 = 2", "\\ No newline at end of file"],
      },
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
    const markerLine = canvas.getByTestId("diff-line-2")
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
      hunk: {
        header: "@@ -1,1 +1,1 @@",
        newStart: 1,
        newLines: 1,
        lines: [`+const s = "<script>window.__xss = true</script>"`],
      },
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
    const line = canvas.getByTestId("diff-line-0")
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
      hunk: {
        header: "@@ -1,2 +1,2 @@",
        newStart: 1,
        newLines: 2,
        lines: [
          "  const short = 1",
          `+const wide = "${"x".repeat(400)}"`,
          `-const gone = "${"y".repeat(400)}"`,
        ],
      },
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
    const addLine = canvas.getByTestId("diff-line-1")
    const scroller = addLine.closest("[class*='overflow-x-auto']")
    expect(scroller).not.toBeNull()
    // The fixture really does overflow — otherwise this story would pass
    // against a viewport wide enough to hide the bug.
    expect(scroller!.scrollWidth).toBeGreaterThan(scroller!.clientWidth)
    for (const id of ["diff-line-0", "diff-line-1", "diff-line-2"]) {
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
