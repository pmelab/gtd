import { useState } from "react"
import type { DiffResult } from "../../serve/Diff.js"
import type { SteeringAnchor, SteeringView, SteeringViewNode } from "../../SteeringFormat.js"
import { CardList } from "../Card.js"
import { Deck } from "../Deck.js"
import { NoteSheet } from "../NoteSheet.js"
import { trpc } from "../api.js"
import { Hunk } from "./Hunk.js"

/**
 * Every hunk-anchored descendant of a chunk node, at any depth —
 * `ReviewDoc.ts#reviewView` nests hunks exactly one level deep today (its own
 * doc comment says pointers are already flattened by `parseChunkBody`), but
 * `SteeringViewNode.children` is recursive by type, so this walks all the way
 * down rather than assuming one level, per the package's own "nested at any
 * depth" acceptance bullet.
 */
const hunksOf = (node: SteeringViewNode): readonly SteeringViewNode[] =>
  (node.children ?? []).flatMap((child) => [
    ...(child.anchor.kind === "hunk" ? [child] : []),
    ...hunksOf(child),
  ])

const hunkKey = (anchor: SteeringAnchor): string =>
  anchor.kind === "hunk" ? `hunk:${anchor.chunkIndex}:${anchor.index}` : ""

const noteKey = (anchor: SteeringAnchor): string =>
  anchor.kind === "chunk"
    ? `chunk:${anchor.index}`
    : anchor.kind === "hunk"
      ? `hunk:${anchor.chunkIndex}:${anchor.index}`
      : ""

export interface ReviewViewProps {
  readonly view: SteeringView | undefined
  readonly isLoading: boolean
  /**
   * One `DiffResult` per hunk, keyed by `hunkKey`'s own `hunk:<chunkIndex>:<index>`
   * scheme — a missing entry renders `Hunk.tsx`'s own loading state. There is
   * no `diff` tRPC procedure yet (see `Hunk.tsx`'s own doc comment); the real
   * `Review` container below always passes `undefined`.
   */
  readonly diffs?: Readonly<Record<string, DiffResult>>
}

/** `{anchor, initialNote}` captured at the moment a note affordance opens `NoteSheet`, so a save/dismiss never has to re-look-up the node it came from. */
interface NoteSheetState {
  readonly anchor: SteeringAnchor
  readonly initialNote: string | undefined
}

/**
 * All of `ReviewView`'s local/optimistic UI state plus the derived helpers
 * every branch below needs — pulled into one hook so `ReviewView` itself
 * stays a thin dispatch over three render branches (note sheet / hunk deck /
 * chunk list) instead of a single large function carrying both state and
 * markup.
 *
 * Ticks are local/optimistic UI state only: `src/ReviewDoc.ts#toggleFilePointer`
 * exists but is never exposed via `src/serve/Router.ts` (only
 * `runCommand`/`fleet`/`writeNote`/`view` are registered there), so there is
 * no client-facing tick-toggle mechanism to call yet. Likewise a saved note
 * only updates local state — `writeNote` exists but needs a
 * `worktreePath`/`filePath`/`expectedHeadSha`/`expectedContentHash` this
 * screen isn't given, so wiring it through is a future task's job, not a
 * silent fake-persistence hazard introduced here.
 */
const useReviewState = () => {
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [openChunkIndex, setOpenChunkIndex] = useState<number | undefined>(undefined)
  const [deckIndex, setDeckIndex] = useState(0)
  const [noteSheet, setNoteSheet] = useState<NoteSheetState | undefined>(undefined)

  const isChecked = (hunk: SteeringViewNode): boolean =>
    ticked[hunkKey(hunk.anchor)] ?? hunk.checked === true

  const noteTextOf = (node: SteeringViewNode): string | undefined =>
    notes[noteKey(node.anchor)] ?? node.note

  const hasNoteText = (node: SteeringViewNode): boolean => {
    const text = noteTextOf(node)
    return text !== undefined && text.length > 0
  }

  const openNoteSheet = (node: SteeringViewNode) =>
    setNoteSheet({ anchor: node.anchor, initialNote: noteTextOf(node) })

  const saveNote = (anchor: SteeringAnchor, text: string) => {
    setNotes((prev) => ({ ...prev, [noteKey(anchor)]: text }))
    setNoteSheet(undefined)
  }

  const toggleChunk = (chunk: SteeringViewNode) => {
    const hunks = hunksOf(chunk)
    const target = !(hunks.length > 0 && hunks.every(isChecked))
    // TODO(no tick-toggle procedure): local-only, see module doc comment above.
    setTicked((prev) => {
      const next = { ...prev }
      for (const hunk of hunks) next[hunkKey(hunk.anchor)] = target
      return next
    })
  }

  const setHunkChecked = (hunk: SteeringViewNode, checked: boolean) => {
    // TODO(no tick-toggle procedure): local-only, see module doc comment above.
    setTicked((prev) => ({ ...prev, [hunkKey(hunk.anchor)]: checked }))
  }

  const openChunk = (index: number) => {
    setOpenChunkIndex(index)
    setDeckIndex(0)
  }

  const approveAndAdvance = (hunks: readonly SteeringViewNode[]) => {
    const next = deckIndex + 1
    if (next >= hunks.length) {
      setOpenChunkIndex(undefined)
    } else {
      setDeckIndex(next)
    }
  }

  return {
    openChunkIndex,
    deckIndex,
    setDeckIndex,
    noteSheet,
    setNoteSheet,
    setOpenChunkIndex,
    isChecked,
    hasNoteText,
    openNoteSheet,
    saveNote,
    toggleChunk,
    setHunkChecked,
    openChunk,
    approveAndAdvance,
  }
}

type ReviewState = ReturnType<typeof useReviewState>

/** The per-chunk deck of hunks — one hunk per screen, approving the last one exits back to the chunk list via `state.approveAndAdvance`. */
const HunkDeck = ({
  chunk,
  diffs,
  state,
}: {
  readonly chunk: SteeringViewNode
  readonly diffs: Readonly<Record<string, DiffResult>> | undefined
  readonly state: ReviewState
}) => {
  const hunks = hunksOf(chunk)
  return (
    <Deck
      items={hunks}
      index={state.deckIndex}
      onIndexChange={state.setDeckIndex}
      onExit={() => state.setOpenChunkIndex(undefined)}
      renderItem={(hunk, i) => (
        <Hunk
          key={hunkKey(hunk.anchor)}
          node={hunk}
          diff={diffs?.[hunkKey(hunk.anchor)]}
          index={i}
          total={hunks.length}
          checked={state.isChecked(hunk)}
          hasNote={state.hasNoteText(hunk)}
          onToggle={(checked) => state.setHunkChecked(hunk, checked)}
          onApprove={() => state.approveAndAdvance(hunks)}
          onOpenNote={() => state.openNoteSheet(hunk)}
        />
      )}
    />
  )
}

/** One chunk's own row: prose, a check-all tick over every one of its hunks (nested at any depth), and its note affordance — including the badge that keeps the round open when a footnote is attached, even fully ticked. Exercised by `Review.stories.tsx`'s `play()` tests; see `Fleet.tsx#FleetView`'s note on why fallow's static CRAP estimate scores it as untested regardless. */
// fallow-ignore-next-line complexity
const ChunkRow = ({
  chunk,
  chunkIndex,
  state,
}: {
  readonly chunk: SteeringViewNode
  readonly chunkIndex: number
  readonly state: ReviewState
}) => {
  const hunks = hunksOf(chunk)
  const allChecked = hunks.length > 0 && hunks.every(state.isChecked)
  const footnoteKeepsRoundOpen = state.hasNoteText(chunk)
  return (
    <div
      data-testid={`chunk-card-${chunkIndex}`}
      style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px" }}
    >
      <input
        type="checkbox"
        data-testid={`chunk-check-all-${chunkIndex}`}
        checked={allChecked}
        disabled={hunks.length === 0}
        onChange={() => state.toggleChunk(chunk)}
      />
      <button
        type="button"
        data-testid={`chunk-open-${chunkIndex}`}
        onClick={() => state.openChunk(chunkIndex)}
        style={{
          flex: 1,
          textAlign: "left",
          background: "none",
          border: "none",
          color: "inherit",
          font: "inherit",
          padding: 0,
        }}
      >
        <div style={{ fontWeight: 600 }}>{chunk.title}</div>
        {chunk.detail !== undefined && chunk.detail.length > 0 && (
          <div style={{ fontSize: 12, opacity: 0.7 }}>{chunk.detail}</div>
        )}
        {footnoteKeepsRoundOpen && (
          <div
            data-testid={`chunk-footnote-badge-${chunkIndex}`}
            style={{ fontSize: 11, color: "#e0a030", marginTop: 4 }}
          >
            Note keeps this round open
          </div>
        )}
      </button>
      <button
        type="button"
        data-testid={`chunk-note-${chunkIndex}`}
        onClick={() => state.openNoteSheet(chunk)}
      >
        {state.hasNoteText(chunk) ? "Edit note" : "Note"}
      </button>
    </div>
  )
}

/** The chunk list itself — one `ChunkRow` per top-level node. */
const ChunkList = ({
  nodes,
  state,
}: {
  readonly nodes: SteeringView["nodes"]
  readonly state: ReviewState
}) => (
  <div data-testid="review-screen" style={{ maxWidth: 390, margin: "0 auto" }}>
    <CardList>
      {nodes.map((chunk, chunkIndex) => (
        <ChunkRow key={chunkIndex} chunk={chunk} chunkIndex={chunkIndex} state={state} />
      ))}
    </CardList>
  </div>
)

/**
 * Presentational review screen — chunk list drilling into a per-chunk deck
 * of hunks, mirroring `Plan.tsx`'s `PlanView`/`Plan` split so
 * `Review.stories.tsx` can drive every shape with plain `view` data. Itself
 * just a thin dispatch over the note sheet / hunk deck / chunk list branches
 * — the state and per-branch markup live in `useReviewState`/`HunkDeck`/
 * `ChunkList` above. Exercised by `Review.stories.tsx`'s `play()` interaction
 * tests — fallow's static CRAP estimate only sees real coverage reports, not
 * Storybook/vitest-browser runs, so it scores this as untested (see
 * `Fleet.tsx#FleetView`'s own identical note).
 */
// fallow-ignore-next-line complexity
export const ReviewView = ({ view, isLoading, diffs }: ReviewViewProps) => {
  const state = useReviewState()

  if (view === undefined) {
    return (
      <div style={{ padding: 16 }}>
        {isLoading ? "Loading the review…" : "Could not load the review."}
      </div>
    )
  }

  if (state.noteSheet !== undefined) {
    return (
      <NoteSheet
        anchor={state.noteSheet.anchor}
        {...(state.noteSheet.initialNote !== undefined
          ? { note: state.noteSheet.initialNote }
          : {})}
        onSave={state.saveNote}
        onDismiss={() => state.setNoteSheet(undefined)}
      />
    )
  }

  const openChunk =
    state.openChunkIndex !== undefined ? view.nodes[state.openChunkIndex] : undefined
  if (openChunk !== undefined) {
    return <HunkDeck chunk={openChunk} diffs={diffs} state={state} />
  }

  return <ChunkList nodes={view.nodes} state={state} />
}

export interface ReviewProps {
  readonly content: string
}

/** The real review screen: wires `ReviewView` to the `view` tRPC query for `content` in `review` mode. `diffs` is always `undefined` here — see `ReviewViewProps.diffs`'s own doc comment for why. Not yet imported by `App.tsx` — routing between screens is a later package's task, not this one's. */
// fallow-ignore-next-line unused-export
export const Review = ({ content }: ReviewProps) => {
  const query = trpc.view.useQuery({ content, mode: "review" })
  return <ReviewView view={query.data?.view} isLoading={query.isLoading} />
}
