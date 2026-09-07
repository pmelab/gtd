import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, within } from "storybook/test"
import type { SteeringView } from "../../SteeringFormat.js"
import { ReviewView } from "./Review.js"

const meta: Meta<typeof ReviewView> = {
  component: ReviewView,
}

export default meta

type Story = StoryObj<typeof ReviewView>

/**
 * Chunk one: three hunks, the last NESTED two levels deep under the second —
 * `ReviewDoc.ts#reviewView` itself only ever nests one level, but the type
 * allows more, so this fixture proves the client's own recursive walk
 * (`hunksOf`) reaches a hunk nested at any depth, not just the first level.
 */
const NESTED_CHUNK: SteeringView["nodes"][number] = {
  title: "Chunk one",
  detail: "Some prose describing chunk one's own intent.",
  anchor: { kind: "chunk", index: 0 },
  children: [
    {
      title: "src/a.ts#3",
      path: "src/a.ts",
      line: 3,
      checked: false,
      anchor: { kind: "hunk", chunkIndex: 0, index: 0 },
    },
    {
      title: "src/b.ts#9",
      path: "src/b.ts",
      line: 9,
      checked: false,
      anchor: { kind: "hunk", chunkIndex: 0, index: 1 },
      children: [
        {
          title: "src/deep.ts#20 (nested two levels down)",
          path: "src/deep.ts",
          line: 20,
          checked: false,
          anchor: { kind: "hunk", chunkIndex: 0, index: 2 },
        },
      ],
    },
  ],
}

/** Chunk two: fully ticked, but carries a footnote — the display-only "keeps the round open" assertion. */
const FOOTNOTE_CHUNK: SteeringView["nodes"][number] = {
  title: "Chunk two",
  detail: "Fully reviewed, but the reviewer left a comment.",
  note: "Please double-check the retry logic before landing.",
  anchor: { kind: "chunk", index: 1 },
  children: [
    {
      title: "src/c.ts#1",
      path: "src/c.ts",
      line: 1,
      checked: true,
      anchor: { kind: "hunk", chunkIndex: 1, index: 0 },
    },
  ],
}

/** Chunk three: a single, unticked hunk — used to prove approving the LAST (and only) hunk in a chunk returns to the chunk list. */
const SINGLE_HUNK_CHUNK: SteeringView["nodes"][number] = {
  title: "Chunk three",
  detail: "One hunk left to review.",
  anchor: { kind: "chunk", index: 2 },
  children: [
    {
      title: "src/d.ts#5",
      path: "src/d.ts",
      line: 5,
      checked: false,
      anchor: { kind: "hunk", chunkIndex: 2, index: 0 },
    },
  ],
}

const SAMPLE_VIEW: SteeringView = {
  header: "sample123",
  nodes: [NESTED_CHUNK, FOOTNOTE_CHUNK, SINGLE_HUNK_CHUNK],
}

export const ChunkCardShowsProseCheckAllAndNoteAffordance: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = canvas.getByTestId("chunk-card-0")
    await expect(card).toHaveTextContent("Chunk one")
    await expect(card).toHaveTextContent("Some prose describing chunk one's own intent.")
    await expect(canvas.getByTestId("chunk-check-all-0")).not.toBeChecked()
    await expect(canvas.getByTestId("chunk-note-0")).toHaveTextContent("Note")
  },
}

export const TickingAChunkTicksEveryHunkIncludingNestedAtAnyDepth: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("chunk-check-all-0"))
    await expect(canvas.getByTestId("chunk-check-all-0")).toBeChecked()

    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await expect(canvas.getByTestId("hunk-tick")).toBeChecked() // hunk 0

    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(canvas.getByTestId("hunk-tick")).toBeChecked() // hunk 1

    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(canvas.getByTestId("hunk-tick")).toBeChecked() // nested hunk 2
    await expect(canvas.getByTestId("hunk-progress")).toHaveTextContent("Hunk 3 of 3")
  },
}

export const UntickingAChunkUnticksEveryHunk: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("chunk-check-all-0"))
    await expect(canvas.getByTestId("chunk-check-all-0")).toBeChecked()
    await fireEvent.click(canvas.getByTestId("chunk-check-all-0"))
    await expect(canvas.getByTestId("chunk-check-all-0")).not.toBeChecked()

    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await expect(canvas.getByTestId("hunk-tick")).not.toBeChecked()
    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(canvas.getByTestId("hunk-tick")).not.toBeChecked()
  },
}

export const ApprovingTheLastHunkInAChunkReturnsToTheChunkList: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("chunk-open-2"))
    await expect(canvas.getByTestId("hunk-screen")).toBeInTheDocument()

    await fireEvent.click(canvas.getByTestId("hunk-tick"))

    await expect(canvas.queryByTestId("hunk-screen")).not.toBeInTheDocument()
    await expect(canvas.getByTestId("review-screen")).toBeInTheDocument()
    await expect(canvas.getByTestId("chunk-card-2")).toBeInTheDocument()
  },
}

export const ChunkCarryingAFootnoteKeepsTheRoundOpenEvenWhenFullyTicked: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("chunk-check-all-1")).toBeChecked()
    await expect(canvas.getByTestId("chunk-footnote-badge-1")).toHaveTextContent(
      "keeps this round open",
    )
  },
}

export const ChunkWithNoFootnoteShowsNoBadgeEvenWhenFullyTicked: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("chunk-check-all-0"))
    await expect(canvas.getByTestId("chunk-check-all-0")).toBeChecked()
    await expect(canvas.queryByTestId("chunk-footnote-badge-0")).not.toBeInTheDocument()
  },
}

export const NoteAffordanceOnAChunkOpensTheNoteSheet: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("chunk-note-0"))
    await expect(canvas.getByTestId("note-sheet")).toBeInTheDocument()
    await expect(canvas.queryByTestId("review-screen")).not.toBeInTheDocument()

    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "Looks good, one nit inline." },
    })
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))

    await expect(canvas.getByTestId("review-screen")).toBeInTheDocument()
    await expect(canvas.getByTestId("chunk-footnote-badge-0")).toBeInTheDocument()
    await expect(canvas.getByTestId("chunk-note-0")).toHaveTextContent("Edit note")
  },
}

export const LoadingStateRendersBeforeTheViewArrives: Story = {
  args: { view: undefined, isLoading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("Loading the review…")).toBeInTheDocument()
  },
}
