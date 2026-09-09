import type { Meta, StoryObj } from "@storybook/react-vite"
import { page } from "@vitest/browser/context"
import { useRef, useState } from "react"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import type { SteeringAnchor, SteeringView } from "../../SteeringFormat.js"
import { TrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { withRealMousePress } from "../testing/realMousePress.js"
import { Review, ReviewView } from "./Review.js"

const meta: Meta<typeof ReviewView> = {
  component: ReviewView,
}

export default meta

type Story = StoryObj<typeof ReviewView>

/** The real `Review` container's args shared by every "real container" story below — one file path, reused rather than repeated at each call site. */
const REAL_REVIEW_ARGS = { filePath: ".gtd/REVIEW.md" }

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

/** Package 02 Task 6: both of a chunk row's own controls (the open button and the note button) meet the 44×44 thumb floor via `Button`'s own `min-h-11 min-w-11`. */
export const BothChunkControlsMeetThe44pxFloor: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    await page.viewport(390, 844)
    const canvas = within(canvasElement)
    const openRect = canvas.getByTestId("chunk-open-0").getBoundingClientRect()
    expect(openRect.width).toBeGreaterThanOrEqual(44)
    expect(openRect.height).toBeGreaterThanOrEqual(44)
    const noteRect = canvas.getByTestId("chunk-note-0").getBoundingClientRect()
    expect(noteRect.width).toBeGreaterThanOrEqual(44)
    expect(noteRect.height).toBeGreaterThanOrEqual(44)
  },
}

/** Spec feedback: `chunk-check-all-<i>` is a bare native `<input type="checkbox">` with no class of its own — its wrapping label is what's sized to the 44px floor instead, since the browser's own checkbox chrome can't be resized directly. */
export const ChunkCheckAllMeetsThe44pxFloor: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    await page.viewport(390, 844)
    const canvas = within(canvasElement)
    const rect = canvas.getByTestId("chunk-check-all-label-0").getBoundingClientRect()
    expect(rect.width).toBeGreaterThanOrEqual(44)
    expect(rect.height).toBeGreaterThanOrEqual(44)
  },
}

/**
 * package 02 Task 6: no pressed story existed for `chunk-open` — pinned here
 * against its real, trusted-press `active:` colour (`ghost` variant). A real
 * mouse press releases as a real click, which fires `onClick` (opening the
 * chunk's hunk deck) — harmless, since the pressed colour is read INSIDE
 * `duringPress`, before release, but it's why this and `chunk-note`'s own
 * pressed story below are two separate stories rather than one sequential
 * one: the first button's release already navigates away.
 */
export const ChunkOpenPressedStateDiffersFromRest: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const open = canvas.getByTestId("chunk-open-0")
    const openRest = getComputedStyle(open).backgroundColor
    await withRealMousePress(open, () => {
      expect(getComputedStyle(open).backgroundColor).not.toBe(openRest)
      expect(getComputedStyle(open).backgroundColor).toBe("rgb(28, 28, 30)")
    })
  },
}

/** package 02 Task 6: no pressed story existed for `chunk-note` — pinned here against its real, trusted-press `active:` colour (`secondary` variant). See `ChunkOpenPressedStateDiffersFromRest`'s own comment for why this is a separate story. */
export const ChunkNotePressedStateDiffersFromRest: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const note = canvas.getByTestId("chunk-note-0")
    const noteRest = getComputedStyle(note).backgroundColor
    await withRealMousePress(note, () => {
      expect(getComputedStyle(note).backgroundColor).not.toBe(noteRest)
      expect(getComputedStyle(note).backgroundColor).toBe("rgb(107, 107, 112)")
    })
  },
}

/** Package 02 Task 6: the chunk-open button's disabled state (zero hunks) is visually distinct — `Button`'s own `disabled:text-disabled` utility applies, not a hand-rolled opacity/cursor pair (a call-site `disabled:opacity-60` used to sit here, and composited `--color-disabled` under 3:1 against the page — removed, not just left unasserted). */
export const ChunkOpenButtonDisabledWhenNoHunks: Story = {
  args: {
    view: {
      nodes: [
        {
          title: "No pointers here",
          anchor: { kind: "chunk", index: 0 },
        },
      ],
    } satisfies SteeringView,
    isLoading: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByTestId("chunk-open-0")
    await expect(button).toBeDisabled()
    // `Button`'s ghost variant: rest text is `--color-text` (#f0f0f0), disabled
    // text is `--color-disabled` (#5a5a5e) — the computed style, not just the
    // `disabled` DOM attribute, is what actually proves it's visually distinct.
    expect(getComputedStyle(button).color).toBe("rgb(90, 90, 94)")
  },
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
 * The seam actually in use for a pure-data `ReviewView` story: with `live`
 * unset (and no live `trpc.diff` transport to fetch through), a hunk screen
 * renders `Hunk.tsx`'s own permanent "Loading diff…" state — this IS what
 * every other story below exercises implicitly; this one says so with a
 * real assertion instead of leaving it merely implied.
 */
export const WithLiveUnsetAHunkScreenShowsLoadingDiffForever: Story = {
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

/**
 * A hand-built `onSetValue` whose write for hunk A (index 0) never resolves
 * until this harness's own "Reject A" button fires it — every OTHER anchor
 * (hunk B, index 1) resolves immediately. Exposes the pending rejection as a
 * DOM control rather than a closure the play function has no seam back into,
 * mirroring `Review.stories.tsx`'s existing recorder-component pattern.
 */
const TwoHunkRevertHarness = () => {
  const pendingRejectRef = useRef<((error: unknown) => void) | undefined>(undefined)
  const onSetValue = (anchor: SteeringAnchor, checked: boolean): Promise<unknown> => {
    void checked
    if (anchor.kind === "hunk" && anchor.index === 0) {
      return new Promise((_resolve, reject) => {
        pendingRejectRef.current = reject
      })
    }
    return Promise.resolve({ ok: true })
  }
  return (
    <>
      <button
        type="button"
        data-testid="reject-hunk-a"
        onClick={() => pendingRejectRef.current?.(new Error("stale token"))}
      >
        Reject A
      </button>
      <ReviewView view={SAMPLE_VIEW} isLoading={false} onSetValue={onSetValue} />
    </>
  )
}

/**
 * Package 03's Task 7: a rejected write for one hunk (anchor A) must not
 * clobber a LATER, already-issued tick on a different hunk (anchor B) — the
 * per-hunk-key sequence number (`useReviewState`'s `seqRef`) is what makes
 * this safe; the previous whole-state `previous` Map snapshot would instead
 * revert B too, since it captured every hunk's state at A's own call time.
 */
export const ARejectedTickOnOneHunkLeavesALaterTickOnAnotherHunkStanding: StoryObj<
  typeof ReviewView
> = {
  render: () => <TwoHunkRevertHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    // Ticks hunk A (index 0) — its own `setValue` never resolves yet.
    // `Hunk.tsx`'s own `onToggle` auto-approves on a tick to `true`, which
    // advances the deck straight to hunk B — never asserted checked here,
    // since by the time the assertion could run the screen has already
    // moved on to a different hunk's own (unrelated) checkbox.
    await fireEvent.click(canvas.getByTestId("hunk-tick"))

    // Now on hunk B's (index 1) own screen — ticks it too; its own
    // `setValue` resolves immediately. Auto-approves again, advancing to the
    // nested hunk (index 2).
    await expect(canvas.getByTestId("hunk-progress")).toHaveTextContent("Hunk 2 / 3")
    await fireEvent.click(canvas.getByTestId("hunk-tick"))
    await expect(canvas.getByTestId("hunk-progress")).toHaveTextContent("Hunk 3 / 3")

    // Now A's write rejects, late — B's tick (a LATER, already-issued write)
    // must still stand.
    await fireEvent.click(canvas.getByTestId("reject-hunk-a"))

    await fireEvent.click(canvas.getByTestId("deck-prev"))
    await expect(canvas.getByTestId("hunk-progress")).toHaveTextContent("Hunk 2 / 3")
    await waitFor(() => expect(canvas.getByTestId("hunk-tick")).toBeChecked()) // still B

    await fireEvent.click(canvas.getByTestId("deck-prev"))
    await expect(canvas.getByTestId("hunk-progress")).toHaveTextContent("Hunk 1 / 3")
    await waitFor(() => expect(canvas.getByTestId("hunk-tick")).not.toBeChecked()) // A reverted
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

/**
 * A dozen extra chunks with no hunks of their own — appended so the chunk
 * list actually overflows the bounded viewport height below, which a
 * `scrollTop` write needs (a browser clamps `scrollTop` to `0` when there's
 * nothing to scroll). Only used by the scroll-restoration story below.
 */
const SCROLL_PADDING_CHUNKS: SteeringView["nodes"] = Array.from({ length: 12 }, (_, i) => ({
  title: `Padding chunk ${i}`,
  detail: "Padding so the chunk list is tall enough to actually scroll.",
  anchor: { kind: "chunk", index: 10 + i },
}))

const SCROLL_VIEW: SteeringView = {
  nodes: [NESTED_CHUNK, FOOTNOTE_CHUNK, SINGLE_HUNK_CHUNK, ...SCROLL_PADDING_CHUNKS],
}

/**
 * T1's own acceptance bullet, proven on the REAL screen (not just
 * `Card.stories.tsx`'s generic shell demo): opening a chunk's deck and
 * backing out of it restores the chunk list's OWN scroll container's
 * `scrollTop` (package 02 Task 5 moved this off `window` entirely — the page
 * itself no longer scrolls). The decorator mirrors `App.tsx`'s own
 * viewport-tall flex column, since `ReviewView` in isolation (no `App`
 * wrapper) otherwise has no bounded height to scroll within.
 */
export const BackFromAChunksDeckRestoresScrollPosition: Story = {
  args: { view: SCROLL_VIEW, isLoading: false },
  decorators: [
    (Story) => (
      <div className="mx-auto flex h-dvh max-w-[390px] flex-col">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    await page.viewport(390, 844)
    const canvas = within(canvasElement)
    const container = canvas.getByTestId("review-scroll-container")
    container.scrollTop = 500
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await expect(canvas.getByTestId("hunk-screen")).toBeInTheDocument()
    await fireEvent.click(canvas.getByTestId("deck-prev"))
    await expect(canvas.getByTestId("review-screen")).toBeInTheDocument()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(canvas.getByTestId("review-scroll-container").scrollTop).toBe(500)
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
 * `diff` procedure, keyed by the same `path`/`line` shape `Router.ts#diffInput`
 * validates.
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

/** Mirrors `Plan.stories.tsx#RealContainerRendersHeadUnresolvedWithNoRetry`'s identical doc comment. */
export const RealContainerRendersHeadUnresolvedWithNoRetry: StoryObj<typeof Review> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => {
          throw {
            error: {
              message: "gtd ui: read refused (head-unresolved)",
              code: -32600,
              data: { code: "BAD_REQUEST", readRefusal: { reason: "head-unresolved" } },
            },
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
    await waitFor(() =>
      expect(canvas.getByText(/Can't read this repository's current commit/)).toBeInTheDocument(),
    )
    expect(canvas.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument()
  },
}

/** Mirrors `Plan.stories.tsx#RealContainerRendersFileVanishedByName`'s identical doc comment. */
export const RealContainerRendersFileVanishedByName: StoryObj<typeof Review> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => {
          throw {
            error: {
              message: "gtd ui: read refused (file-vanished)",
              code: -32600,
              data: { code: "NOT_FOUND", readRefusal: { reason: "file-vanished" } },
            },
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
    await waitFor(() => expect(canvas.getByText(/no longer being served/)).toBeInTheDocument())
    expect(canvas.queryByText("Could not load the review.")).not.toBeInTheDocument()
  },
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
  readonly args: { readonly filePath: string }
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

/** Mirrors `Plan.stories.tsx#RealContainerRecoversInPlaceFromAStaleShaRefusal`'s identical doc comment, applied to `Review`'s own note write. */
export const RealContainerRecoversInPlaceFromAStaleShaRefusal: StoryObj<typeof Review> = {
  render: (args) => {
    let readCalls = 0
    let writeCalls = 0
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => {
            readCalls += 1
            return {
              ok: true,
              content: REVIEW_CONTENT,
              headSha: readCalls === 1 ? "abc123" : "def456",
              contentHash: "deadbeef",
              view: SAMPLE_REVIEW_VIEW,
            }
          },
          diff: () => ({ kind: "binary" }),
          writeNote: (input) => {
            writeCalls += 1
            if (writeCalls === 1) {
              throw {
                error: {
                  message: "gtd ui: write refused (stale-token)",
                  code: -32600,
                  data: { code: "CONFLICT", writeRefusal: { reason: "stale-token", moved: "sha" } },
                },
              }
            }
            expect((input as { expectedHeadSha: string }).expectedHeadSha).toBe("def456")
            return { ok: true }
          },
        }}
      >
        <Review {...args} />
      </TrpcTestProvider>
    )
  },
  args: REAL_REVIEW_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openChunkNoteAndType(canvas, "Looks good overall.")
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    // `chunk-note-0` is a fixed-label button ("Note"/"Edit note"), never the
    // note's own text — "Edit note" is what proves a note now exists.
    await waitFor(() => expect(canvas.getByTestId("chunk-note-0")).toHaveTextContent("Edit note"))
    // The silent retry must never surface the refusal banner — see
    // `Plan.stories.tsx#RealContainerRecoversInPlaceFromAStaleShaRefusal`'s
    // identical doc comment for why a "Saved" status label is fine here.
    expect(canvas.queryByText(/committed a change underneath you/)).not.toBeInTheDocument()
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

/** A `useState`-backed recorder for the `done` mutation's input — mirrors `WriteCallRecorder`'s identical reasoning. */
const DoneCallRecorder = ({
  args,
  onRegisterDone,
}: {
  readonly args: { readonly filePath: string }
  readonly onRegisterDone: (record: (input: unknown) => void) => void
}) => {
  const [calls, setCalls] = useState<readonly unknown[]>([])
  onRegisterDone((input) => setCalls((prev) => [...prev, input]))
  return (
    <>
      <div data-testid="done-calls">{JSON.stringify(calls)}</div>
      <Review {...args} />
    </>
  )
}

/** Proves the REAL `Review` container wires "Save & Done" to `trpc.done` (never a second, disjoint `writeNote` call) using the exact same tokens — mirrors `Plan.stories.tsx`'s identical story. */
export const RealContainerSaveAndDoneCallsTrpcDone: StoryObj<typeof Review> = {
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
  },
}

/** A `useState`-backed recorder for the `setValue` mutation's own input — mirrors `WriteCallRecorder`'s identical reasoning. */
const SetValueCallRecorder = ({
  args,
  onRegisterSetValue,
}: {
  readonly args: { readonly filePath: string }
  readonly onRegisterSetValue: (record: (input: unknown) => void) => void
}) => {
  const [calls, setCalls] = useState<readonly unknown[]>([])
  onRegisterSetValue((input) => setCalls((prev) => [...prev, input]))
  return (
    <>
      <div data-testid="set-value-calls">{JSON.stringify(calls)}</div>
      <Review {...args} />
    </>
  )
}

/** Proves the REAL `Review` container write-throughs a single hunk tick via `trpc.setValue`, using the exact tokens `readSteeringFile` returned — closes the gap the spec review flagged (T4's "write hunk ticks through to disk"). */
export const RealContainerWriteThroughsAHunkTickViaSetValue: StoryObj<typeof Review> = {
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
          setValue: (input) => {
            record(input)
            return { ok: true }
          },
        }}
      >
        <SetValueCallRecorder args={args} onRegisterSetValue={(fn) => (record = fn)} />
      </TrpcTestProvider>
    )
  },
  args: REAL_REVIEW_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("chunk-open-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await fireEvent.click(canvas.getByTestId("hunk-tick"))
    await waitFor(() =>
      expect(canvas.getByTestId("set-value-calls")).toHaveTextContent('"checked":true'),
    )
    await expect(canvas.getByTestId("set-value-calls")).toHaveTextContent(
      JSON.stringify({
        filePath: ".gtd/REVIEW.md",
        expectedHeadSha: "abc123",
        expectedContentHash: "deadbeef",
        mode: "review",
        anchor: { kind: "hunk", chunkIndex: 0, index: 0 },
        checked: true,
      }).slice(1, -1),
    )
  },
}

/** Proves the REAL `Review` container write-throughs a chunk check-all as EXACTLY ONE `setValue` call at the chunk anchor — never one call per hunk beneath it (T4's own "never one call per hunk" acceptance bullet). */
export const RealContainerChunkCheckAllCallsSetValueOnce: StoryObj<typeof Review> = {
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
            view: { nodes: [NESTED_CHUNK] } satisfies SteeringView,
          }),
          diff: () => ({ kind: "binary" }),
          setValue: (input) => {
            record(input)
            return { ok: true }
          },
        }}
      >
        <SetValueCallRecorder args={args} onRegisterSetValue={(fn) => (record = fn)} />
      </TrpcTestProvider>
    )
  },
  args: REAL_REVIEW_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("chunk-check-all-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("chunk-check-all-0"))
    await waitFor(() =>
      expect(canvas.getByTestId("set-value-calls")).toHaveTextContent('"checked":true'),
    )
    const calls = JSON.parse(canvas.getByTestId("set-value-calls").textContent ?? "[]") as unknown[]
    await expect(calls).toHaveLength(1)
    await expect(calls[0]).toEqual({
      filePath: ".gtd/REVIEW.md",
      expectedHeadSha: "abc123",
      expectedContentHash: "deadbeef",
      mode: "review",
      anchor: { kind: "chunk", index: 0 },
      checked: true,
    })
  },
}

/** After `done` resolves, the client renders the terminal "handed back" panel — no further server round trip, no way back to any list. Mirrors `Plan.stories.tsx`'s identical story. */
export const RealContainerRendersHandedBackPanelAfterDone: StoryObj<typeof Review> = {
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
        done: () => ({ ok: true }),
      }}
    >
      <Review {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_REVIEW_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await openChunkNoteAndType(canvas, "handing back now")
    await fireEvent.click(canvas.getByTestId("note-sheet-done"))
    await waitFor(() => expect(canvas.getByTestId("handed-back-panel")).toBeInTheDocument())
    await expect(canvas.queryByTestId("review-screen")).not.toBeInTheDocument()
  },
}

/**
 * A FRESH mount of the real `Review` container against a `readSteeringFile`
 * resolver whose hunk is already `checked: true` — the exact byte state a
 * real `setValue` write leaves on disk. No tick happens before the
 * assertion, so `useReviewState`'s local `ticked` map is still empty —
 * `isChecked`'s own `hunk.checked === true` fallback is what must be reading
 * true here, not an optimistic override. The chunk's check-all reflects it
 * too, since it derives from the exact same `isChecked` predicate. This
 * proves only that a fresh mount re-reads server state, NOT that a reload
 * survives — package 03's real reload acceptance is `ui-lifecycle.feature`'s
 * `@live` "a page reload does not kill gtd ui" scenario, which exercises the
 * actual process across a real reload; nothing here can, since Storybook
 * never tears down and remounts the page.
 */
export const RealContainerReadsAnAlreadyTickedHunkOnFreshMount: StoryObj<typeof Review> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content: REVIEW_CONTENT,
          headSha: "abc123",
          contentHash: "deadbeef",
          view: {
            nodes: [
              {
                title: "Add calculator",
                anchor: { kind: "chunk", index: 0 },
                children: [
                  {
                    title: "./src/calc.ts#1",
                    path: "./src/calc.ts",
                    line: 1,
                    checked: true,
                    anchor: { kind: "hunk", chunkIndex: 0, index: 0 },
                  },
                ],
              },
            ],
          } satisfies SteeringView,
        }),
        diff: () => ({ kind: "binary" }),
      }}
    >
      <Review {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_REVIEW_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("chunk-check-all-0")).toBeInTheDocument())
    await expect(canvas.getByTestId("chunk-check-all-0")).toBeChecked()
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await expect(canvas.getByTestId("hunk-tick")).toBeChecked()
  },
}
