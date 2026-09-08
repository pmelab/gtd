import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import type { SteeringView } from "../../SteeringFormat.js"
import { TrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { Review, ReviewView } from "./Review.js"

const meta: Meta<typeof ReviewView> = {
  component: ReviewView,
}

export default meta

type Story = StoryObj<typeof ReviewView>

/** The real `Review` container's args shared by every "real container" story below — one worktree/file pair, reused rather than repeated at each call site. */
const REAL_REVIEW_ARGS = { worktreePath: "/repo", filePath: ".gtd/REVIEW.md" }

/** Opens chunk 0's note affordance and types `text` into the sheet — the setup every "real container" note story below shares before diverging into Save vs Save & Done. */
const openChunkNoteAndType = async (
  canvas: ReturnType<typeof within>,
  text: string,
): Promise<void> => {
  await waitFor(() => expect(canvas.getByTestId("chunk-note-0")).toBeInTheDocument())
  await fireEvent.click(canvas.getByTestId("chunk-note-0"))
  await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), { target: { value: text } })
}

/** Clicks a checkbox testid then asserts it lands checked — collapses the click+assert pair repeated across the tick/untick stories below into one call. */
const clickAndExpectChecked = async (canvas: ReturnType<typeof within>, testId: string) => {
  await fireEvent.click(canvas.getByTestId(testId))
  await expect(canvas.getByTestId(testId)).toBeChecked()
}

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

/**
 * The seam actually in use for a pure-data `ReviewView` story: with no
 * `worktreePath` given (and no live `trpc.diff` transport to fetch through),
 * a hunk screen renders `Hunk.tsx`'s own permanent "Loading diff…" state —
 * this IS what every other story below exercises implicitly; this one says
 * so with a real assertion instead of leaving it merely implied.
 */
export const WithNoWorktreePathAHunkScreenShowsLoadingDiffForever: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await expect(canvas.getByTestId("hunk-diff-loading")).toBeInTheDocument()
  },
}

export const TickingAChunkTicksEveryHunkIncludingNestedAtAnyDepth: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await clickAndExpectChecked(canvas, "chunk-check-all-0")

    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await expect(canvas.getByTestId("hunk-tick")).toBeChecked() // hunk 0

    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(canvas.getByTestId("hunk-tick")).toBeChecked() // hunk 1

    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(canvas.getByTestId("hunk-tick")).toBeChecked() // nested hunk 2
    await expect(canvas.getByTestId("hunk-progress")).toHaveTextContent("Hunk 3 / 3")
  },
}

export const UntickingAChunkUnticksEveryHunk: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await clickAndExpectChecked(canvas, "chunk-check-all-0")
    await fireEvent.click(canvas.getByTestId("chunk-check-all-0"))
    await expect(canvas.getByTestId("chunk-check-all-0")).not.toBeChecked()

    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await expect(canvas.getByTestId("hunk-tick")).not.toBeChecked() // hunk 0

    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(canvas.getByTestId("hunk-tick")).not.toBeChecked() // hunk 1

    // "un-ticking a chunk un-ticks every hunk in it" is otherwise only
    // implied by sharing code with the tick path — assert the NESTED hunk
    // (deck position 3, same depth `TickingAChunkTicksEveryHunkIncludingNestedAtAnyDepth`
    // checks) too, not just the two depth-1 ones.
    await fireEvent.click(canvas.getByTestId("deck-next"))
    await expect(canvas.getByTestId("hunk-tick")).not.toBeChecked() // nested hunk 2
    await expect(canvas.getByTestId("hunk-progress")).toHaveTextContent("Hunk 3 / 3")
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

/** T1's own acceptance bullet, proven on the REAL screen (not just `Card.stories.tsx`'s generic shell demo): opening a chunk's deck and backing out of it restores the chunk list's scroll position, via the SAME `useScrollRestoration` hook `Card.stories.tsx`'s demo dogfoods. The spacer decorator (not part of `ReviewView` itself) exists purely so the page is tall enough to scroll in the first place. */
export const BackFromAChunksDeckRestoresScrollPosition: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  decorators: [
    (Story) => (
      <div>
        <Story />
        <div style={{ height: 2000 }} />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    window.scrollTo(0, 500)
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await expect(canvas.getByTestId("hunk-screen")).toBeInTheDocument()
    await fireEvent.click(canvas.getByTestId("deck-prev"))
    await expect(canvas.getByTestId("review-screen")).toBeInTheDocument()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(window.scrollY).toBe(500)
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
    await clickAndExpectChecked(canvas, "chunk-check-all-0")
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

/**
 * T6: "the sheet opens from a chunk, from a hunk, and from a paragraph seam"
 * — the CHUNK half is covered above; this covers the HUNK half specifically
 * (`Hunk.stories.tsx` alone can't prove it: its own stories pass a fake
 * `onOpenNote` that never mounts the real `NoteSheet`).
 */
export const NoteAffordanceOnAHunkOpensTheNoteSheet: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await expect(canvas.getByTestId("hunk-screen")).toBeInTheDocument()

    await fireEvent.click(canvas.getByTestId("hunk-note-affordance"))
    await expect(canvas.getByTestId("note-sheet")).toBeInTheDocument()
    await expect(canvas.getByText("Note on this hunk")).toBeInTheDocument()

    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "Double-check this line." },
    })
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))

    // Back on the hunk screen, note visible via the affordance's own label.
    await expect(canvas.getByTestId("hunk-screen")).toBeInTheDocument()
    await expect(canvas.getByTestId("hunk-note-affordance")).toHaveTextContent("Edit note")
  },
}

export const LoadingStateRendersBeforeTheViewArrives: Story = {
  args: { view: undefined, isLoading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("Loading the review…")).toBeInTheDocument()
  },
}

/** A `##` chunk with prose and no file pointers at all (`files: []` — a real, pinned `ReviewDoc.ts` shape) must not be a blank, unrecoverable dead-end: its open button is disabled rather than opening an empty `Deck`. */
export const ChunkWithZeroHunksIsNotABlankDeadEnd: Story = {
  args: {
    view: {
      nodes: [
        {
          title: "Just prose, no pointers",
          detail: "Nothing to review here.",
          anchor: { kind: "chunk", index: 0 },
        },
      ],
    } satisfies SteeringView,
    isLoading: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const openButton = canvas.getByTestId("chunk-open-0")
    expect(openButton).toBeDisabled()
    await expect(canvas.getByText("No file pointers")).toBeInTheDocument()
    await fireEvent.click(openButton)
    // A disabled button's click is a no-op, but assert the review screen is
    // still the one showing regardless — never an empty/broken deck.
    await expect(canvas.getByTestId("review-screen")).toBeInTheDocument()
  },
}

/**
 * The REAL `Review` container (not `ReviewView` in isolation): proves a hunk
 * screen actually fetches its own diff through a live `trpc.diff.useQuery`
 * round-trip, closing the exact gap the spec review flagged — `diffs` was
 * always `undefined` from `Review`, so `Hunk.tsx` rendered `hunk-diff-loading`
 * forever. `TrpcTestProvider`'s mock link stands in for `Server.ts`'s real
 * `diff` procedure, keyed by the same `worktreePath`/`path`/`line` shape
 * `Router.ts#diffInput` validates.
 */
const REVIEW_CONTENT = `# Review: abc1234

<!-- base: abc1234def5678901234567890123456789abcd -->

## Add calculator

- [ ] ./src/calc.ts#1
`

const SAMPLE_REVIEW_VIEW = {
  nodes: [
    {
      title: "Add calculator",
      anchor: { kind: "chunk", index: 0 },
      children: [
        {
          title: "./src/calc.ts#1",
          path: "./src/calc.ts",
          line: 1,
          checked: false,
          anchor: { kind: "hunk", chunkIndex: 0, index: 0 },
        },
      ],
    },
  ],
}

export const RealContainerFetchesTheCurrentHunksDiffLive: StoryObj<typeof Review> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content: REVIEW_CONTENT,
          headSha: "abc123",
          contentHash: "deadbeef",
          view: SAMPLE_REVIEW_VIEW,
        }),
        diff: (input) => {
          expect(input).toEqual({ path: "./src/calc.ts", line: 1 })
          return {
            kind: "hunk",
            diff: { path: "./src/calc.ts", hunks: [] },
            hunk: { header: "@@ -0,0 +1 @@", newStart: 1, newLines: 1, lines: ["+const x = 1"] },
          }
        },
      }}
    >
      <Review {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_REVIEW_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("chunk-open-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await waitFor(() => expect(canvas.getByTestId("diff-line-0")).toHaveTextContent("const x = 1"))
    await expect(canvas.queryByTestId("hunk-diff-loading")).not.toBeInTheDocument()
  },
}

/** A `useState`-backed recorder, not a plain mutated array — the `writeNote` resolver runs OUTSIDE React, so mutating a closed-over array would never trigger the re-render `write-calls` needs to actually reflect a new call. */
const WriteCallRecorder = ({
  args,
  onRegisterWriteNote,
}: {
  readonly args: { readonly worktreePath: string; readonly filePath: string }
  readonly onRegisterWriteNote: (record: (input: unknown) => void) => void
}) => {
  const [calls, setCalls] = useState<readonly unknown[]>([])
  onRegisterWriteNote((input) => setCalls((prev) => [...prev, input]))
  return (
    <>
      <div data-testid="write-calls">{JSON.stringify(calls)}</div>
      <Review {...args} />
    </>
  )
}

/** Proves the OTHER half of the real container: saving a chunk note actually calls `writeNote` with the exact tokens `readSteeringFile` returned, not just a local-state update. */
export const RealContainerWriteThroughsASavedNoteViaWriteNote: StoryObj<typeof Review> = {
  render: (args) => {
    let record: (input: unknown) => void = () => {}
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => ({
            ok: true,
            content: REVIEW_CONTENT,
            headSha: "abc123",
            contentHash: "deadbeef",
            view: SAMPLE_REVIEW_VIEW,
          }),
          diff: () => ({ kind: "binary" }),
          writeNote: (input) => {
            record(input)
            return { ok: true }
          },
        }}
      >
        <WriteCallRecorder args={args} onRegisterWriteNote={(fn) => (record = fn)} />
      </TrpcTestProvider>
    )
  },
  args: REAL_REVIEW_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openChunkNoteAndType(canvas, "Looks good overall.")
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() =>
      expect(canvas.getByTestId("write-calls")).toHaveTextContent("Looks good overall."),
    )
    await expect(canvas.getByTestId("write-calls")).toHaveTextContent(
      JSON.stringify({
        filePath: ".gtd/REVIEW.md",
        expectedHeadSha: "abc123",
        expectedContentHash: "deadbeef",
        mode: "review",
        anchor: { kind: "chunk", index: 0 },
        text: "Looks good overall.",
      }).slice(1, -1),
    )
  },
}

/**
 * A refused write (a stale-token `CONFLICT`, here standing in for any
 * `writeNote` failure) must revert the optimistic local note override —
 * otherwise the badge keeps claiming a footnote that was never actually
 * written, forever, with no way for the human to tell.
 */
export const RealContainerRevertsTheOptimisticNoteOnARefusedWrite: StoryObj<typeof Review> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content: REVIEW_CONTENT,
          headSha: "abc123",
          contentHash: "deadbeef",
          view: SAMPLE_REVIEW_VIEW,
        }),
        diff: () => ({ kind: "binary" }),
        writeNote: () => {
          throw new Error("stale token")
        },
      }}
    >
      <Review {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_REVIEW_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openChunkNoteAndType(canvas, "This never actually lands.")
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    // Immediately after save, the optimistic badge shows (before the refusal
    // resolves) — then the refusal reverts it.
    await waitFor(() =>
      expect(canvas.queryByTestId("chunk-footnote-badge-0")).not.toBeInTheDocument(),
    )
    await expect(canvas.getByTestId("chunk-note-0")).toHaveTextContent("Note")
  },
}

/** A `useState`-backed recorder for BOTH the `done` mutation's input and how many times `onDone` fired — mirrors `WriteCallRecorder`'s identical reasoning. */
const DoneCallRecorder = ({
  args,
  onRegisterDone,
}: {
  readonly args: { readonly worktreePath: string; readonly filePath: string }
  readonly onRegisterDone: (record: (input: unknown) => void) => void
}) => {
  const [calls, setCalls] = useState<readonly unknown[]>([])
  const [onDoneCount, setOnDoneCount] = useState(0)
  onRegisterDone((input) => setCalls((prev) => [...prev, input]))
  return (
    <>
      <div data-testid="done-calls">{JSON.stringify(calls)}</div>
      <div data-testid="on-done-count">{onDoneCount}</div>
      <Review {...args} onDone={() => setOnDoneCount((prev) => prev + 1)} />
    </>
  )
}

/** Proves the REAL `Review` container wires "Save & Done" to `trpc.done` (never a second, disjoint `writeNote` call) using the exact same tokens, and calls `onDone` once it resolves — mirrors `Plan.stories.tsx`'s identical story. */
export const RealContainerSaveAndDoneCallsTrpcDoneThenOnDone: StoryObj<typeof Review> = {
  render: (args) => {
    let record: (input: unknown) => void = () => {}
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => ({
            ok: true,
            content: REVIEW_CONTENT,
            headSha: "abc123",
            contentHash: "deadbeef",
            view: SAMPLE_REVIEW_VIEW,
          }),
          diff: () => ({ kind: "binary" }),
          done: (input) => {
            record(input)
            return { ok: true }
          },
          writeNote: () => {
            throw new Error("writeNote must never be called by Save & Done")
          },
        }}
      >
        <DoneCallRecorder args={args} onRegisterDone={(fn) => (record = fn)} />
      </TrpcTestProvider>
    )
  },
  args: REAL_REVIEW_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openChunkNoteAndType(canvas, "handing back now")
    await fireEvent.click(canvas.getByTestId("note-sheet-done"))
    await waitFor(() =>
      expect(canvas.getByTestId("done-calls")).toHaveTextContent("handing back now"),
    )
    await expect(canvas.getByTestId("done-calls")).toHaveTextContent(
      JSON.stringify({
        filePath: ".gtd/REVIEW.md",
        expectedHeadSha: "abc123",
        expectedContentHash: "deadbeef",
        mode: "review",
        anchor: { kind: "chunk", index: 0 },
        text: "handing back now",
      }).slice(1, -1),
    )
    await waitFor(() => expect(canvas.getByTestId("on-done-count")).toHaveTextContent("1"))
  },
}
