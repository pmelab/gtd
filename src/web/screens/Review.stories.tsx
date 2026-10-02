import type { Meta, StoryObj } from "@storybook/react-vite"
import { viewport } from "../testing/browserContext.js"
import { useRef, useState } from "react"
import { expect, fireEvent, waitFor, within } from "storybook/test"
import { token } from "../testing/palette.js"
import { steeringFormatFor } from "../../steering/index.js"
import type { SteeringAnchor, SteeringView } from "../../steering/index.js"

/** The real `review` format's own `view` — used only by the image-collapsing regression story below, which must exercise the actual server-side projection rather than a hand-built fixture. */
const reviewFormat = steeringFormatFor("review")!
import { TrpcTestProvider } from "../testing/TrpcTestProvider.js"
import { withRealMousePress } from "../testing/realMousePress.js"
import { WriteStoreProvider } from "../writeStore.js"
import { Review, ReviewView } from "./Review.js"

/** A harness exercising a token-guarded write needs ITS OWN `WriteStoreProvider` (nested inside the global decorator's bare one) configured with fake tokens — see `Question.stories.tsx`'s identical constant/doc comment. */
const FAKE_TOKENS = { headSha: "deadbeef", contentHash: "cafef00d" }
const refetchFakeTokens = () =>
  Promise.resolve({
    expectedHeadSha: FAKE_TOKENS.headSha,
    expectedContentHash: FAKE_TOKENS.contentHash,
  })

const meta: Meta<typeof ReviewView> = {
  component: ReviewView,
  args: { filePath: ".gtd/REVIEW.md" },
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
    await viewport(390, 844)
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
    await viewport(390, 844)
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
      expect(getComputedStyle(open).backgroundColor).toBe(token("surface"))
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
      expect(getComputedStyle(note).backgroundColor).toBe(token("border"))
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
    expect(getComputedStyle(button).color).toBe(token("disabled"))
  },
}

/**
 * Package 01: the hunk deck no longer renders the chunk's `body` at all — the
 * description already lives on the chunk list row (`detail`), and a persistent
 * header above every hunk of the chunk was fixed vertical space taken from the
 * deck on a 390px phone. `descriptionNodes`/`body` still flow through the wire
 * unchanged (`review.ts#reviewView`); this story just proves the hunk screen
 * itself renders none of it.
 */
const DESCRIPTION_CHUNK: SteeringView["nodes"][number] = {
  title: "Chunk with a rich description",
  detail: "A heading followed by a fenced code block.",
  // Package 02: the SAME single-row `detail` string, now carrying its own
  // inline structure — a `**bold**` word renders as a real `<strong>`
  // inside this same row, never as literal asterisks.
  detailInline: [
    { kind: "text", value: "A " },
    { kind: "strong", children: [{ kind: "text", value: "heading" }] },
    { kind: "text", value: " followed by a fenced code block." },
  ],
  anchor: { kind: "chunk", index: 3 },
  body: [
    {
      title: "Watch this",
      anchor: { kind: "paragraph", line: 0 },
      block: { kind: "heading", depth: 3 },
    },
    {
      title: "some detail",
      anchor: { kind: "paragraph", line: 2 },
      block: { kind: "code", text: "const x = 1" },
    },
  ],
  children: [
    {
      title: "src/e.ts#1",
      path: "src/e.ts",
      line: 1,
      checked: false,
      anchor: { kind: "hunk", chunkIndex: 3, index: 0 },
    },
  ],
}

const VIEW_WITH_DESCRIPTION_CHUNK: SteeringView = {
  header: "sample123",
  nodes: [NESTED_CHUNK, FOOTNOTE_CHUNK, SINGLE_HUNK_CHUNK, DESCRIPTION_CHUNK],
}

export const AChunkDescriptionsHeadingAndFencedCodeBlockRenderNowhereOnTheChunksScreen: Story = {
  args: { view: VIEW_WITH_DESCRIPTION_CHUNK, isLoading: false },
  // The viewport-tall column `App.tsx` itself provides — mirrors
  // `BackFromAChunksDeckRestoresScrollPosition`'s identical decorator, needed
  // here so `hunk-deck` has a REAL bounded height to reclaim rather than
  // collapsing to its own content's natural size, which would pass whether or
  // not a header sibling still ate part of it.
  decorators: [
    (Story) => (
      <div className="mx-auto flex h-dvh max-w-[390px] flex-col">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    // Phone width — the same 390px convention `Card.stories.tsx`'s
    // `RendersCorrectlyAt390pxWide` measures against.
    await viewport(390, 844)
    const canvas = within(canvasElement)
    // The chunk card itself still renders `detail` as a single text row —
    // the description's only surviving surface, once the hunk deck's own
    // copy is gone.
    const card = canvas.getByTestId("chunk-card-3")
    await expect(card).toHaveTextContent("A heading followed by a fenced code block.")
    // The bold word inside that same row is a real element, not literal
    // `**heading**` asterisks.
    const strong = card.querySelector("strong")
    expect(strong).not.toBeNull()
    expect(strong).toHaveTextContent("heading")

    await fireEvent.click(canvas.getByTestId("chunk-open-3"))

    // The hunk deck renders none of `body` — even for a chunk carrying a
    // heading and a fenced code block, `chunk.body` is dropped entirely, not
    // collapsed or shown on the first hunk only.
    expect(canvas.queryByTestId("prose-paragraphs")).not.toBeInTheDocument()

    // `Deck` is the hunk screen's only flex child now — no `shrink-0
    // overflow-auto border-b` sibling above it reserving vertical space, so
    // the whole `hunk-deck` box is exactly the one `deck` element.
    const hunkDeck = canvas.getByTestId("hunk-deck")
    expect(hunkDeck.children).toHaveLength(1)
    expect(hunkDeck.firstElementChild).toBe(canvas.getByTestId("deck"))

    // The measured payoff: `deck`'s own box is the FULL `hunk-deck` box, not
    // a fraction of it reduced by a reserved header above it — a regression
    // reintroducing even a small `shrink-0` sibling would shrink `deck`'s
    // height below `hunk-deck`'s without shrinking `hunk-deck` itself.
    const hunkDeckRect = hunkDeck.getBoundingClientRect()
    const deckRect = canvas.getByTestId("deck").getBoundingClientRect()
    expect(deckRect.height).toBe(hunkDeckRect.height)
    // The positive control: `hunk-deck` itself genuinely fills most of the
    // 844px viewport column (`App.tsx`'s own shell), so the assertion above
    // is pinning something worth reclaiming, not two empty boxes agreeing.
    expect(hunkDeckRect.height).toBeGreaterThan(700)
  },
}

/**
 * Package 02, R2/T5: `detailInline` collapses an image to its own alt text
 * SERVER-SIDE — the chunk row renders no `<img>` element at all, so no
 * remote fetch can ever fire from the compact chunk list.
 */
export const ChunkRowImageCollapsesToAltTextNoRemoteFetch: Story = {
  args: {
    // A REAL `![alt](url)` through the actual server-side parser
    // (`reviewDescriptor.view`), not a hand-built `detailInline` fixture — a
    // fixture with no `image` node in it would pass this assertion for the
    // wrong reason (spec feedback).
    view: reviewFormat.view(
      [
        "# Review: abc1234",
        "<!-- base: abc1234def5678901234567890123456789abcd -->",
        "",
        "## Chunk with an image in its description",
        "",
        "See ![a diagram](https://x.example/p.png) here.",
        "",
        "- [ ] ./src/e.ts#1",
        "",
      ].join("\n"),
    ),
    isLoading: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = canvas.getByTestId("chunk-card-0")
    await expect(card).toHaveTextContent("See a diagram here.")
    expect(card.querySelector("img")).toBeNull()
  },
}

/**
 * Spec feedback: a nested list item's own text used to vanish from
 * `detailInline` entirely — only the top-level items contributed. A real
 * chunk description whose leading run is a nested list, through the actual
 * server-side parser, must show the nested item's own text in the compact
 * chunk row, exactly as it already does in `detail`.
 */
export const ChunkRowNestedListItemTextSurvivesInDetailInline: Story = {
  args: {
    view: reviewFormat.view(
      [
        "# Review: abc1234",
        "<!-- base: abc1234def5678901234567890123456789abcd -->",
        "",
        "## Chunk with a nested list in its description",
        "",
        "- item one",
        "- item two",
        "  - nested item",
        "",
        // A `*`-marker pointer list, deliberately: CommonMark merges
        // adjacent SAME-marker bullet lists into one node even across a
        // blank line, which would swallow the description above.
        "* [ ] ./src/e.ts#1",
        "",
      ].join("\n"),
    ),
    isLoading: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = canvas.getByTestId("chunk-card-0")
    await expect(card).toHaveTextContent("item one item two nested item")
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
  const onSetValue = (anchor: SteeringAnchor, checked: boolean) => (): Promise<unknown> => {
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
      <WriteStoreProvider tokens={FAKE_TOKENS} refetchTokens={refetchFakeTokens}>
        <ReviewView
          view={SAMPLE_VIEW}
          filePath=".gtd/REVIEW.md"
          isLoading={false}
          onSetValue={onSetValue}
        />
      </WriteStoreProvider>
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
    await viewport(390, 844)
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
    // The sheet is a MODAL over the list, not a screen instead of it: the
    // chunk the note is about stays on screen (blurred) behind it, which is
    // the whole reason the takeover was dropped.
    await expect(canvas.getByTestId("review-screen")).toBeInTheDocument()
    await expect(canvas.getByTestId("note-sheet-scrim")).toBeInTheDocument()

    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "Looks good, one nit inline." },
    })
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))

    await expect(canvas.getByTestId("review-screen")).toBeInTheDocument()
    await expect(canvas.getByTestId("chunk-footnote-badge-0")).toBeInTheDocument()
    // The note itself replaces the control that created it.
    await expect(canvas.getByTestId("chunk-note-0")).toHaveTextContent(
      "Looks good, one nit inline.",
    )
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

    // Back on the hunk screen, the note itself has taken the control's
    // place — the same rule a chunk row follows on the list screen.
    await expect(canvas.getByTestId("hunk-screen")).toBeInTheDocument()
    await expect(canvas.getByTestId("hunk-note-affordance")).toHaveTextContent(
      "Double-check this line.",
    )

    // And tapping it reopens the sheet on that text.
    await fireEvent.click(canvas.getByTestId("hunk-note-affordance"))
    await expect(canvas.getByTestId("note-sheet-textarea")).toHaveValue("Double-check this line.")
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
            hunks: [{ header: "@@ -0,0 +1 @@", newStart: 1, newLines: 1, lines: ["+const x = 1"] }],
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
    // Line 0 is now the hunk's own `@@` header (package 03 T1: every
    // resolved hunk renders one, not just the whole-file fallback); the
    // body starts at line 1.
    await waitFor(() => expect(canvas.getByTestId("diff-line-1")).toHaveTextContent("const x = 1"))
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
    // Once a note exists, `chunk-note-0` IS the note: its own text is what
    // proves the write landed, and tapping it reopens the sheet.
    await waitFor(() =>
      expect(canvas.getByTestId("chunk-note-0")).toHaveTextContent("Looks good overall."),
    )
    // The silent retry must never surface the refusal banner — see
    // `Plan.stories.tsx#RealContainerRecoversInPlaceFromAStaleShaRefusal`'s
    // identical doc comment for why a "Saved" status label is fine here.
    expect(canvas.queryByText(/committed a change underneath you/)).not.toBeInTheDocument()
  },
}

/**
 * package 02 Requirement A / Task 2's own client-side proof, mirroring
 * `Plan.stories.tsx#RealContainerSavesTwoNotesInARowWithNoRefetchBetweenThem`
 * applied to `Review`'s own note-write path: the mock `readSteeringFile`
 * never advances its own `contentHash` ("deadbeef", fixed) — standing in for
 * "before a `ui.format` write's own invalidate/refetch has landed" — so a
 * second note save fired right after the first succeeding only succeeds if
 * `Review` swapped its own compare-and-swap token for the hash the FIRST
 * `writeNote` call actually returned.
 */
export const RealContainerSavesTwoNotesInARowWithNoRefetchBetweenThem: StoryObj<typeof Review> = {
  render: (args) => {
    let expectedHash = "deadbeef"
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
            const { expectedContentHash, text } = input as {
              readonly expectedContentHash: string
              readonly text: string
            }
            if (expectedContentHash !== expectedHash) {
              throw {
                error: {
                  message: "gtd ui: write refused (stale-token)",
                  code: -32600,
                  data: {
                    code: "CONFLICT",
                    writeRefusal: { reason: "stale-token", moved: "content-hash" },
                  },
                },
              }
            }
            expectedHash = `deadbeef-${text}`
            return { ok: true, contentHash: expectedHash }
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

    await openChunkNoteAndType(canvas, "first note")
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() => expect(canvas.getByTestId("chunk-note-0")).toHaveTextContent("first note"))

    // Fired immediately — the mock `readSteeringFile` still answers with the
    // ORIGINAL "deadbeef", so this only succeeds off `Review`'s own local
    // token override, never the query cache.
    await openChunkNoteAndType(canvas, "second note")
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() =>
      expect(canvas.queryByTestId("save-indicator-dismiss")).not.toBeInTheDocument(),
    )
    await expect(canvas.getByTestId("chunk-note-0")).toHaveTextContent("second note")
  },
}

/**
 * package 02 Task 2's other own bullet, mirroring
 * `Plan.stories.tsx#RealContainerRecoversAfterAContentHashRefusalRatherThanWedging`
 * applied to `Review`: a `stale-token`/`moved: "content-hash"` refusal must
 * drop `Review`'s own override rather than reuse it forever. First save
 * succeeds (setting the override), a second is refused `content-hash`
 * regardless of what it sends, and a third — redone by hand, since there is
 * no `Try again` control left to resend it — succeeds only by falling back
 * to the STILL-cached `"deadbeef"`.
 */
export const RealContainerRecoversAfterAContentHashRefusalRatherThanWedging: StoryObj<
  typeof Review
> = {
  render: (args) => {
    let writeNoteCallCount = 0
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
            writeNoteCallCount += 1
            const { expectedContentHash } = input as { readonly expectedContentHash: string }
            if (writeNoteCallCount === 1) {
              return { ok: true, contentHash: "deadbeef2" }
            }
            const refuseContentHash = () => {
              throw {
                error: {
                  message: "gtd ui: write refused (stale-token)",
                  code: -32600,
                  data: {
                    code: "CONFLICT",
                    writeRefusal: { reason: "stale-token", moved: "content-hash" },
                  },
                },
              }
            }
            if (writeNoteCallCount === 2) return refuseContentHash()
            if (expectedContentHash !== "deadbeef") return refuseContentHash()
            return { ok: true, contentHash: "deadbeef3" }
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

    await openChunkNoteAndType(canvas, "first note")
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() => expect(canvas.getByTestId("chunk-note-0")).toHaveTextContent("first note"))

    await openChunkNoteAndType(canvas, "second note")
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() =>
      expect(canvas.getByTestId("save-indicator-message")).toHaveTextContent(
        "The file's content changed underneath you",
      ),
    )

    // No `Try again` left to resend it — redoing the action by hand is the
    // only path, and it must still succeed once the wedged override is
    // dropped.
    await openChunkNoteAndType(canvas, "second note")
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await waitFor(() => expect(canvas.getByTestId("chunk-note-0")).toHaveTextContent("second note"))
    await expect(canvas.queryByTestId("save-indicator-dismiss")).not.toBeInTheDocument()
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
        note: {
          filePath: ".gtd/REVIEW.md",
          expectedHeadSha: "abc123",
          expectedContentHash: "deadbeef",
          mode: "review",
          anchor: { kind: "chunk", index: 0 },
          text: "handing back now",
        },
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

/**
 * A chunk list is otherwise a stack of identical rows with no answer to "how
 * much of this round is left" — the header is the only place the round's own
 * size is stated. A chunk counts as approved only when every one of its
 * hunks is ticked.
 */
export const ChunkListHeaderCountsApprovedChunks: Story = {
  args: {
    view: {
      nodes: [
        {
          title: "Chunk one",
          anchor: { kind: "chunk", index: 0 },
          children: [
            {
              title: "src/a.ts#1",
              checked: true,
              anchor: { kind: "hunk", chunkIndex: 0, index: 0 },
            },
          ],
        },
        {
          title: "Chunk two",
          anchor: { kind: "chunk", index: 1 },
          children: [
            {
              title: "src/b.ts#1",
              checked: false,
              anchor: { kind: "hunk", chunkIndex: 1, index: 0 },
            },
          ],
        },
      ],
    } satisfies SteeringView,
    isLoading: false,
  },
  play: async ({ canvasElement }) => {
    await viewport(390, 844)
    const canvas = within(canvasElement)
    expect(canvas.getByTestId("review-progress")).toHaveTextContent("1 / 2 chunks approved")

    await fireEvent.click(canvas.getByTestId("chunk-check-all-1"))
    expect(canvas.getByTestId("review-progress")).toHaveTextContent("2 / 2 chunks approved")
  },
}

/**
 * Once a chunk carries a note, the note itself takes the control's place:
 * "Edit note" says only that one exists, while the note says what it is —
 * and tapping it reopens the same sheet that wrote it. The "Note" control
 * only exists while there is nothing to show.
 */
export const AChunksNoteReplacesItsNoteControlAndReopensForEditing: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    await viewport(390, 844)
    const canvas = within(canvasElement)

    // Nothing written yet: a control, labelled as one.
    await expect(canvas.getByTestId("chunk-note-0")).toHaveTextContent("Note")

    await fireEvent.click(canvas.getByTestId("chunk-note-0"))
    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "The retry loop needs a ceiling." },
    })
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))

    const note = canvas.getByTestId("chunk-note-0")
    await expect(note).toHaveTextContent("The retry loop needs a ceiling.")
    expect(note.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)

    // Tapping the note reopens the sheet on that same text, ready to edit.
    await fireEvent.click(note)
    await expect(canvas.getByTestId("note-sheet-textarea")).toHaveValue(
      "The retry loop needs a ceiling.",
    )
    await fireEvent.change(canvas.getByTestId("note-sheet-textarea"), {
      target: { value: "Edited: the retry loop needs a ceiling." },
    })
    await fireEvent.click(canvas.getByTestId("note-sheet-save"))
    await expect(canvas.getByTestId("chunk-note-0")).toHaveTextContent(
      "Edited: the retry loop needs a ceiling.",
    )
  },
}

/** The review screen's own Done control — present on the chunk list and inside the hunk deck, ending the turn with no note, exactly like `Plan`'s. */
export const RealContainerTapsReviewDoneFromTheListRendersHandedBackPanel: StoryObj<typeof Review> =
  {
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
          }}
        >
          <DoneCallRecorder args={args} onRegisterDone={(fn) => (record = fn)} />
        </TrpcTestProvider>
      )
    },
    args: REAL_REVIEW_ARGS,
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement)
      await waitFor(() => expect(canvas.getByTestId("review-done")).toBeInTheDocument())
      await fireEvent.click(canvas.getByTestId("review-done"))
      await waitFor(() => expect(canvas.getByTestId("handed-back-panel")).toBeInTheDocument())
      await expect(canvas.getByTestId("done-calls")).toHaveTextContent(JSON.stringify([{}]))
    },
  }

export const ReviewDoneRendersInsideTheHunkDeck: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false, onDone: () => Promise.resolve() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await expect(canvas.getByTestId("deck-done")).toHaveTextContent("Done")
    await expect(canvas.queryByTestId("review-done")).not.toBeInTheDocument()
  },
}

export const NoOnDonePropRendersNoReviewDoneControl: Story = {
  args: { view: SAMPLE_VIEW, isLoading: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByTestId("review-done")).not.toBeInTheDocument()
  },
}

/**
 * Package 03 Task 1's own `busy` boolean, on the chunk list's own
 * `review-done` footer button: `setValue`'s resolver is held open by a
 * manually-triggered `settle-write` button (mirrors
 * `Plan.stories.tsx#TheSavingThenSavedAnnouncementCarriesNoVisibleText`'s own
 * pattern), proving the write store's own pending count — not a locally
 * derived "is THIS screen's own write still running" flag — is what disables
 * the control. A tap while disabled never reaches `done` at all (native
 * `disabled` discards it, package 03 Task 3), and the control re-enables the
 * instant the held write settles.
 */
export const ReviewDoneDisabledWhileAWriteIsPending: StoryObj<typeof Review> = {
  render: (args) => {
    let settle: (() => void) | undefined
    let doneCalls = 0
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
          setValue: () =>
            new Promise((resolve) => {
              settle = () => resolve({ ok: true, contentHash: "deadbeef2" })
            }),
          done: () => {
            doneCalls += 1
            return { ok: true }
          },
        }}
      >
        <Review {...args} />
        <button type="button" data-testid="settle-write" onClick={() => settle?.()}>
          Settle
        </button>
        <div data-testid="done-call-count">{doneCalls}</div>
      </TrpcTestProvider>
    )
  },
  args: REAL_REVIEW_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("review-done")).toBeInTheDocument())
    expect(canvas.getByTestId("review-done")).not.toBeDisabled()

    await fireEvent.click(canvas.getByTestId("chunk-check-all-0"))
    await waitFor(() => expect(canvas.getByTestId("review-done")).toBeDisabled())

    await fireEvent.click(canvas.getByTestId("review-done"))
    expect(canvas.queryByTestId("handed-back-panel")).not.toBeInTheDocument()
    expect(canvas.getByTestId("done-call-count")).toHaveTextContent("0")

    await fireEvent.click(canvas.getByTestId("settle-write"))
    await waitFor(() => expect(canvas.getByTestId("review-done")).not.toBeDisabled())
  },
}

/**
 * The same `busy` boolean reaches `deck-done` too (package 03 Task 1's own
 * "has to reach all of them"): the pending write is issued from the CHUNK
 * LIST's own tick, before the hunk deck ever opens — proving `busy` is one
 * queue-wide signal, not scoped to whichever screen issued the write.
 */
export const DeckDoneDisabledWhileAWriteIssuedFromTheListIsPending: StoryObj<typeof Review> = {
  render: (args) => {
    let settle: (() => void) | undefined
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
          setValue: () =>
            new Promise((resolve) => {
              settle = () => resolve({ ok: true, contentHash: "deadbeef2" })
            }),
        }}
      >
        <Review {...args} />
        <button type="button" data-testid="settle-write" onClick={() => settle?.()}>
          Settle
        </button>
      </TrpcTestProvider>
    )
  },
  args: REAL_REVIEW_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("review-done")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("chunk-check-all-0"))
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))

    await waitFor(() => expect(canvas.getByTestId("deck-done")).toBeInTheDocument())
    expect(canvas.getByTestId("deck-done")).toBeDisabled()

    await fireEvent.click(canvas.getByTestId("settle-write"))
    await waitFor(() => expect(canvas.getByTestId("deck-done")).not.toBeDisabled())
  },
}

/**
 * Package 03 Task 3's own "tapping Done disables it immediately, before the
 * response lands" bullet: `done`'s own resolver here never settles at all,
 * so the ONLY way this assertion can pass with no `waitFor` in between is if
 * `writeStore.ts#save`'s own synchronous `set({ pendingCount: s.pendingCount
 * + 1, saveStatus: "saving" })` already flushed a re-render before the next
 * line runs — proving the disable isn't waiting on the mutation's own round
 * trip.
 */
export const ReviewDoneDisablesImmediatelyOnTapBeforeTheResponseLands: StoryObj<typeof Review> = {
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
        done: () => new Promise(() => {}),
      }}
    >
      <Review {...args} />
    </TrpcTestProvider>
  ),
  args: REAL_REVIEW_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByTestId("review-done")).toBeInTheDocument())
    expect(canvas.getByTestId("review-done")).not.toBeDisabled()

    await fireEvent.click(canvas.getByTestId("review-done"))
    // No `waitFor`/`await` for the mutation itself — `done`'s own promise
    // never resolves, so a disable that depended on its response would still
    // read `false` here.
    expect(canvas.getByTestId("review-done")).toBeDisabled()
  },
}

/** A chunk carrying two hunks — ticking the first auto-advances the deck straight to the second (`Hunk.tsx`'s own tick-is-approve gesture), so two taps fired back to back land on two DIFFERENT `setValue` calls with no `await` between them: exactly the "double-tap" shape package 01 exists to serialize, since nothing in the UI otherwise stops the second tap's write from racing the first's. */
const TWO_HUNK_CHUNK_VIEW: SteeringView = {
  nodes: [
    {
      title: "Two hunks",
      anchor: { kind: "chunk", index: 0 },
      children: [
        {
          title: "src/a.ts#1",
          path: "src/a.ts",
          line: 1,
          checked: false,
          anchor: { kind: "hunk", chunkIndex: 0, index: 0 },
        },
        {
          title: "src/b.ts#1",
          path: "src/b.ts",
          line: 1,
          checked: false,
          anchor: { kind: "hunk", chunkIndex: 0, index: 1 },
        },
      ],
    },
  ],
}

/**
 * Package 01 Task 2's own acceptance bullet: two ticks fired back to back
 * (no `await` between the two `fireEvent.click` calls) reach the mock
 * `setValue` resolver IN ORDER, and the second call's `expectedContentHash`
 * is the FIRST write's own post-format hash — never the query cache's still-
 * stale one — proving the store's own drain serializes the whole write
 * thunk (including the compare-and-swap token read), not just the network
 * call.
 */
export const TwoQuickHunkTicksSerializeThroughTheWriteStore: StoryObj<typeof Review> = {
  render: (args) => {
    let record: (input: unknown) => void = () => {}
    let callCount = 0
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => ({
            ok: true,
            content: REVIEW_CONTENT,
            headSha: "abc123",
            contentHash: "deadbeef",
            view: TWO_HUNK_CHUNK_VIEW,
          }),
          diff: () => ({ kind: "binary" }),
          setValue: (input) => {
            record(input)
            callCount += 1
            return { ok: true, contentHash: `deadbeef-${callCount}` }
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

    // Two taps, no `await` between them: the first ticks hunk A and
    // auto-advances the deck to hunk B in the SAME synchronous event-handler
    // flush, so the second `fireEvent.click` below lands on hunk B's own
    // (now-mounted) checkbox before hunk A's `setValue` call has resolved.
    fireEvent.click(canvas.getByTestId("hunk-tick"))
    fireEvent.click(canvas.getByTestId("hunk-tick"))

    await waitFor(() => {
      const calls = JSON.parse(
        canvas.getByTestId("set-value-calls").textContent ?? "[]",
      ) as readonly { readonly anchor: { readonly index: number } }[]
      expect(calls).toHaveLength(2)
    })

    const calls = JSON.parse(
      canvas.getByTestId("set-value-calls").textContent ?? "[]",
    ) as readonly {
      readonly anchor: { readonly index: number }
      readonly expectedContentHash: string
    }[]
    // Order: hunk A (index 0) first, hunk B (index 1) second — never
    // collapsed, never reordered.
    expect(calls[0]?.anchor.index).toBe(0)
    expect(calls[1]?.anchor.index).toBe(1)
    // The second call's token is the FIRST call's own post-format hash
    // ("deadbeef-1"), read inside the queued thunk at dequeue time — not
    // "deadbeef", the query cache's value at the time both taps fired.
    expect(calls[0]?.expectedContentHash).toBe("deadbeef")
    expect(calls[1]?.expectedContentHash).toBe("deadbeef-1")
  },
}

/** A chunk carrying three hunks — enough for a burst of three queued refusals, one per hunk, with no `await` between any of the three taps. */
const THREE_HUNK_CHUNK_VIEW: SteeringView = {
  nodes: [
    {
      title: "Three hunks",
      anchor: { kind: "chunk", index: 0 },
      children: [
        {
          title: "src/a.ts#1",
          path: "src/a.ts",
          line: 1,
          checked: false,
          anchor: { kind: "hunk", chunkIndex: 0, index: 0 },
        },
        {
          title: "src/b.ts#1",
          path: "src/b.ts",
          line: 1,
          checked: false,
          anchor: { kind: "hunk", chunkIndex: 0, index: 1 },
        },
        {
          title: "src/c.ts#1",
          path: "src/c.ts",
          line: 1,
          checked: false,
          anchor: { kind: "hunk", chunkIndex: 0, index: 2 },
        },
      ],
    },
  ],
}

/**
 * Package 02 Task 5's own acceptance: a burst refusing three queued writes
 * within a few hundred milliseconds shows the LATEST refusal's sentence,
 * appended with a count of the other two still-failed targets — and that
 * count shrinks as each of THOSE clears, via a later success (never the
 * auto-collapse timer, which leaves every dot standing). Every `setValue`
 * call refuses the same way, so the three taps (no `await` between any of
 * them, mirroring `TwoQuickHunkTicksSerializeThroughTheWriteStore`'s own
 * pattern) each land on a DIFFERENT hunk via the deck's own tick-advances
 * gesture.
 */
export const ABurstOfThreeRefusalsShowsTheLatestPlusACountOfTheOthers: StoryObj<typeof Review> = {
  render: (args) => {
    // Refuses a hunk's FIRST write, succeeds on any later one to the SAME
    // anchor — lets the story clear one of the OTHER (non-current) burst
    // targets later by ticking it again, without touching the current one.
    const attempted = new Set<number>()
    return (
      <TrpcTestProvider
        resolvers={{
          readSteeringFile: () => ({
            ok: true,
            content: REVIEW_CONTENT,
            headSha: "abc123",
            contentHash: "deadbeef",
            view: THREE_HUNK_CHUNK_VIEW,
          }),
          diff: () => ({ kind: "binary" }),
          setValue: (input) => {
            const { index } = (input as { readonly anchor: { readonly index: number } }).anchor
            if (attempted.has(index)) return { ok: true, contentHash: `deadbeef-${index}` }
            attempted.add(index)
            throw {
              error: {
                message: "gtd ui: write refused (stale-token)",
                code: -32600,
                data: {
                  code: "CONFLICT",
                  writeRefusal: { reason: "stale-token", moved: "content-hash" },
                },
              },
            }
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
    await waitFor(() => expect(canvas.getByTestId("chunk-open-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))

    // Three taps, no `await` between any of them — each ticks the CURRENT
    // hunk and auto-advances the deck to the next one in the same
    // synchronous flush, so all three land on three different hunks' own
    // checkboxes before any of their writes has settled.
    fireEvent.click(canvas.getByTestId("hunk-tick"))
    fireEvent.click(canvas.getByTestId("hunk-tick"))
    fireEvent.click(canvas.getByTestId("hunk-tick"))

    await waitFor(() =>
      expect(canvas.getByTestId("save-indicator-message")).toHaveTextContent(
        "and 2 other writes didn't land",
      ),
    )

    // Ticking hunk 3 (the LAST in the chunk) auto-approves straight back to
    // the chunk list, per `Deck`'s own past-the-last-item exit — so by now
    // the chunk list, not the hunk deck, is on screen. Reopening it lands
    // back on hunk 0 (one of the "2 others", never the currently-shown
    // target) — ticking it again fires its SECOND write, which succeeds,
    // clearing only its own dot. The count shrinks from 2 to 1 on THIS
    // success, never on the auto-collapse timer, and the currently-shown
    // sentence (hunk 2's own, untouched) stays exactly as it was.
    await waitFor(() => expect(canvas.getByTestId("chunk-open-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await expect(canvas.getByTestId("hunk-progress")).toHaveTextContent("Hunk 1 / 3")
    await fireEvent.click(canvas.getByTestId("hunk-tick"))

    await waitFor(() =>
      expect(canvas.getByTestId("save-indicator-message")).toHaveTextContent(
        "and 1 other write didn't land",
      ),
    )
    expect(canvas.getByTestId("save-indicator-message")).toHaveTextContent(
      "The file's content changed underneath you",
    )
  },
}

/**
 * Package 01's own redesign: `Dismiss` is the only control left on the
 * indicator, and it empties the WHOLE failed map in one tap rather than just
 * the currently-shown target — two refused hunk ticks (A, B) show B's own
 * sentence plus "…and 1 other write didn't land", and one `Dismiss` tap
 * clears both dots at once, not just B's.
 */
export const DismissClearsEveryFailedTargetAtOnce: StoryObj<typeof Review> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content: REVIEW_CONTENT,
          headSha: "abc123",
          contentHash: "deadbeef",
          view: TWO_HUNK_CHUNK_VIEW,
        }),
        diff: () => ({ kind: "binary" }),
        setValue: () => {
          throw {
            error: {
              message: "gtd ui: write refused (stale-token)",
              code: -32600,
              data: {
                code: "CONFLICT",
                writeRefusal: { reason: "stale-token", moved: "content-hash" },
              },
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
    await waitFor(() => expect(canvas.getByTestId("chunk-open-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))

    // Two taps, no `await` between them — hunk A (index 0) then hunk B
    // (index 1) both refuse; the indicator currently shows B's own sentence
    // plus "…and 1 other write didn't land".
    fireEvent.click(canvas.getByTestId("hunk-tick"))
    fireEvent.click(canvas.getByTestId("hunk-tick"))
    await waitFor(() =>
      expect(canvas.getByTestId("save-indicator-message")).toHaveTextContent(
        "and 1 other write didn't land",
      ),
    )

    // One `Dismiss` tap empties the WHOLE failed map, not just the
    // currently-shown target — the indicator goes from two dots straight to
    // none.
    await fireEvent.click(canvas.getByTestId("save-indicator-dismiss"))
    await waitFor(() => expect(canvas.queryByTestId("save-indicator")).not.toBeInTheDocument())
  },
}

/**
 * Spec feedback on package 01: ticking a chunk's own "check all" fires ONE
 * physical `setValue` call that every one of its hunks' own cells optimistically
 * mirrors (`useReviewState#toggleChunk`'s `shadow`) — a refusal of that ONE
 * write must show as ONE dot, never one per mirrored hunk. `THREE_HUNK_CHUNK_VIEW`
 * is what makes an overcount visible: with the old "piggyback via `save`"
 * shape this showed "…and 2 other writes didn't land" for a single refused
 * request; `otherFailedCount` must stay exactly `0`.
 */
export const RefusingAChunkCheckAllFilesExactlyOneDotNotOnePerHunk: StoryObj<typeof Review> = {
  render: (args) => (
    <TrpcTestProvider
      resolvers={{
        readSteeringFile: () => ({
          ok: true,
          content: REVIEW_CONTENT,
          headSha: "abc123",
          contentHash: "deadbeef",
          view: THREE_HUNK_CHUNK_VIEW,
        }),
        diff: () => ({ kind: "binary" }),
        setValue: () => {
          throw {
            error: {
              message: "gtd ui: write refused (stale-token)",
              code: -32600,
              data: {
                code: "CONFLICT",
                writeRefusal: { reason: "stale-token", moved: "content-hash" },
              },
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
    await waitFor(() => expect(canvas.getByTestId("chunk-check-all-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("chunk-check-all-0"))

    await waitFor(() =>
      expect(canvas.getByTestId("save-indicator-message")).toHaveTextContent(
        "The file's content changed underneath you",
      ),
    )
    // The suffix exists ONLY when `otherFailedCount > 0` — its absence here
    // is the assertion that one refused write is exactly one dot, not three.
    expect(canvas.getByTestId("save-indicator-message")).not.toHaveTextContent("other write")

    await fireEvent.click(canvas.getByTestId("save-indicator-dismiss"))
    await waitFor(() => expect(canvas.getByTestId("chunk-check-all-0")).not.toBeChecked())
    // Every hunk's own mirrored tick rolled back too, not just the first.
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await expect(canvas.getByTestId("hunk-tick")).not.toBeChecked()
  },
}

/**
 * Package 02 Task 4's own acceptance: the 5000ms auto-collapse leaves the
 * failed marker standing (the human may not have read it), while `Dismiss`
 * collapses AND clears it in the same tap — the two ways out of the
 * expanded state are deliberately not equivalent.
 */
export const AutoCollapseLeavesTheMarkerStandingUnlikeDismiss: StoryObj<typeof Review> = {
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
        setValue: () => {
          throw {
            error: {
              message: "gtd ui: write refused (stale-token)",
              code: -32600,
              data: {
                code: "CONFLICT",
                writeRefusal: { reason: "stale-token", moved: "content-hash" },
              },
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
    await waitFor(() => expect(canvas.getByTestId("chunk-open-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await fireEvent.click(canvas.getByTestId("hunk-tick"))

    await waitFor(() => expect(canvas.getByTestId("save-indicator-expanded")).toBeInTheDocument())
    await waitFor(() => expect(canvas.getByTestId("save-indicator-marker")).toBeInTheDocument(), {
      timeout: 6_000,
    })

    // Tapping the marker re-expands the SAME message — the auto-collapse
    // never cleared it.
    await fireEvent.click(canvas.getByTestId("save-indicator-marker"))
    await waitFor(() =>
      expect(canvas.getByTestId("save-indicator-message")).toHaveTextContent(
        "The file's content changed underneath you",
      ),
    )

    await fireEvent.click(canvas.getByTestId("save-indicator-dismiss"))
    await waitFor(() => expect(canvas.queryByTestId("save-indicator")).not.toBeInTheDocument())
  },
}

/**
 * Package 02 Task 4's own full-sequence acceptance: an expanded refusal
 * auto-collapses to a marker after 5000ms, a tap re-expands the SAME
 * message, and a LATER successful write to the SAME target (re-ticking the
 * same hunk, not `Dismiss`) is what finally clears the marker — the third of
 * the three ways a failed dot is allowed to shrink (Task 5's own rule).
 */
export const TheFullRefusalLifecycleEndsOnALaterSuccessNotDismiss: StoryObj<typeof Review> = {
  render: (args) => {
    let callCount = 0
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
          setValue: () => {
            callCount += 1
            if (callCount === 1) {
              throw {
                error: {
                  message: "gtd ui: write refused (stale-token)",
                  code: -32600,
                  data: {
                    code: "CONFLICT",
                    writeRefusal: { reason: "stale-token", moved: "content-hash" },
                  },
                },
              }
            }
            return { ok: true, contentHash: "deadbeef2" }
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
    await waitFor(() => expect(canvas.getByTestId("chunk-open-0")).toBeInTheDocument())
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await fireEvent.click(canvas.getByTestId("hunk-tick")) // first write: refuses

    await waitFor(() => expect(canvas.getByTestId("save-indicator-expanded")).toBeInTheDocument())
    await waitFor(() => expect(canvas.getByTestId("save-indicator-marker")).toBeInTheDocument(), {
      timeout: 6_000,
    })

    await fireEvent.click(canvas.getByTestId("save-indicator-marker"))
    await waitFor(() =>
      expect(canvas.getByTestId("save-indicator-message")).toHaveTextContent(
        "The file's content changed underneath you",
      ),
    )

    // A later write to the SAME target (the same hunk, re-ticked) succeeds —
    // never `Dismiss` — and that success is what clears the marker. The
    // indicator itself may still show a transient `saved` dot (Task 3's own
    // linger), so the failed marker/message being gone is the assertion,
    // not the indicator's total absence. The FIRST tick already auto-
    // approved straight back to the chunk list (the chunk's only hunk, so
    // `Deck` exits past the last item) — reopening it lands back on the
    // same hunk for the second tick.
    await fireEvent.click(canvas.getByTestId("chunk-open-0"))
    await fireEvent.click(canvas.getByTestId("hunk-tick"))
    await waitFor(() => {
      expect(canvas.queryByTestId("save-indicator-marker")).not.toBeInTheDocument()
      expect(canvas.queryByTestId("save-indicator-expanded")).not.toBeInTheDocument()
    })
  },
}

/**
 * Requirement A's own named proof: "A `zustand` store defined at module
 * scope is a singleton by default; whichever scoping the store uses must
 * keep that isolation, and the stories that mount two screens are what
 * prove it." Two `Review` screens, mounted side by side, share no store if
 * — and only if — `busy` (the store's own `pendingCount > 0`) is per-screen:
 * a hunk tick that never settles in the FIRST screen must leave the
 * SECOND screen's own `review-done` enabled throughout. A module-scope
 * singleton (or a dropped `WriteStoreProvider` `useRef`) would instead
 * disable BOTH.
 */
export const TwoScreensMountedSideBySideShareNoStore: StoryObj<typeof Review> = {
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
        setValue: () => new Promise(() => {}),
      }}
    >
      <div data-testid="screen-a">
        <Review {...args} />
      </div>
      <div data-testid="screen-b">
        <Review {...args} />
      </div>
    </TrpcTestProvider>
  ),
  args: REAL_REVIEW_ARGS,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screenA = within(canvas.getByTestId("screen-a"))
    const screenB = within(canvas.getByTestId("screen-b"))

    await waitFor(() => expect(screenA.getByTestId("chunk-check-all-0")).toBeInTheDocument())
    expect(screenB.getByTestId("review-done")).not.toBeDisabled()

    // A's own write never settles — this is `busy` staying true in A for
    // the rest of the story.
    await fireEvent.click(screenA.getByTestId("chunk-check-all-0"))
    await waitFor(() => expect(screenA.getByTestId("review-done")).toBeDisabled())

    // B's own `review-done` must stay enabled the whole time — a shared
    // store would disable it the instant A's own write was issued.
    expect(screenB.getByTestId("review-done")).not.toBeDisabled()
  },
}

const threadChunk = (
  waitingOn: "human" | "agent",
  entries: readonly { author: "me" | "agent"; text: string }[],
): SteeringView => ({
  header: "threads",
  nodes: [
    {
      title: "Threaded chunk",
      anchor: { kind: "chunk", index: 0 },
      thread: { name: "t1", entries, waitingOn },
      children: [
        {
          title: "src/e.ts#1",
          path: "src/e.ts",
          line: 1,
          checked: false,
          anchor: { kind: "hunk", chunkIndex: 0, index: 0 },
        },
      ],
    },
  ],
})

export const AnOpenThreadRendersAsAConversationWithAWaitingBadge: Story = {
  args: {
    view: threadChunk("human", [
      { author: "me", text: "Why this retry count?" },
      { author: "agent", text: "It matches the upstream default." },
    ]),
    isLoading: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("chunk-thread-0-waiting")).toBeInTheDocument()
    await expect(canvas.getByTestId("chunk-thread-0-entry-0")).toHaveAttribute("data-author", "me")
    await expect(canvas.getByTestId("chunk-thread-0-entry-1")).toHaveAttribute(
      "data-author",
      "agent",
    )
  },
}

export const AThreadWaitingOnTheAgentShowsNoBadge: Story = {
  args: {
    view: threadChunk("agent", [{ author: "me", text: "Why this retry count?" }]),
    isLoading: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId("chunk-thread-0")).toBeInTheDocument()
    await expect(canvas.queryByTestId("chunk-thread-0-waiting")).not.toBeInTheDocument()
  },
}
