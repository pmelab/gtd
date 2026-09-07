import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, fireEvent, within } from "storybook/test"
import type { DiffResult } from "../../serve/Diff.js"
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
      await expect(canvas.getByTestId("hunk-progress")).toHaveTextContent("Hunk 2 of 5")
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
