import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, fireEvent, within } from "storybook/test"
import type { DiffResult } from "../../ui/Diff.js"
import type { SteeringViewNode } from "../../SteeringFormat.js"
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
