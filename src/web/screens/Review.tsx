import { useState } from "react"
import type { DiffResult } from "../../serve/Diff.js"
import type { SteeringAnchor, SteeringView, SteeringViewNode } from "../../SteeringFormat.js"
import { CardList } from "../Card.js"
import { Deck } from "../Deck.js"
import { NoteSheet } from "../NoteSheet.js"
import { trpc } from "../api.js"
import { useScrollRestoration } from "../useScrollRestoration.js"
import { Hunk, type HunkProps } from "./Hunk.js"

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
   * scheme — a TEST SEAM ONLY: `Review.stories.tsx` drives every diff shape
   * (whole-file banner, binary, refused) with plain pre-resolved data, no
   * mocked tRPC transport required. When absent, `HunkDeck` fetches each
   * hunk's diff live via `trpc.diff` instead (see `worktreePath` below) — the
   * real `Review` container never passes this prop.
   */
  readonly diffs?: Readonly<Record<string, DiffResult>>
  /**
   * The worktree `trpc.diff` resolves `path`/`line` pointers against — real
   * hunk screens fetch through `Server.ts`'s `diff` procedure
   * (`Diff.ts#resolveDiff`) using this. Stories that pass `diffs` directly
   * never set this; `Review` (the real container) always does.
   */
  readonly worktreePath?: string
  /**
   * Called with a saved note's `anchor`/`text` — the real `Review` container
   * wires this to an actual `writeNote` mutation (compare-and-swap against
   * the `headSha`/`contentHash` its own `readSteeringFile` fetch returned),
   * returning `writeNote.mutateAsync`'s OWN promise so `useReviewState` can
   * revert its optimistic override on a rejection (a `CONFLICT` refusal, a
   * network failure, …) — otherwise a refused write leaves the local
   * override in place forever, and the "keeps this round open" badge keeps
   * claiming a footnote that was never actually written. Local optimistic
   * state (below) still updates immediately either way, so the sheet's own
   * save feels instant. Absent in `Review.stories.tsx`'s pure-data stories.
   */
  readonly onSaveNote?: (anchor: SteeringAnchor, text: string) => Promise<unknown>
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
 * Ticks are STILL local/optimistic UI state only:
 * `src/ReviewDoc.ts#toggleFilePointer`/`toggleChunkEdits` exist, but there is
 * no format-agnostic "toggle" member on `SteeringFormat` the way `annotate`
 * is one — adding that (and the router surface it'd need) is a real design
 * decision for a format-agnostic tick primitive, not this screen's call to
 * make alone. A saved NOTE, by contrast, already had everywhere it needed:
 * `annotate` is that exact generic primitive, so `onSaveNote` (when the
 * container supplies one) write-throughs via `writeNote` for real.
 */
const useReviewState = (
  onSaveNote?: (anchor: SteeringAnchor, text: string) => Promise<unknown>,
) => {
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [openChunkIndex, setOpenChunkIndex] = useState<number | undefined>(undefined)
  const [deckIndex, setDeckIndex] = useState(0)
  const [noteSheet, setNoteSheet] = useState<NoteSheetState | undefined>(undefined)
  const scroll = useScrollRestoration()

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
    // A refused/failed write reverts the optimistic override — otherwise a
    // CONFLICT (stale token, anchor moved, …) would leave this note showing
    // (and the "keeps this round open" badge claiming it) forever, even
    // though the file was never actually touched.
    onSaveNote?.(anchor, text)?.catch(() => {
      setNotes((prev) => {
        const next = { ...prev }
        delete next[noteKey(anchor)]
        return next
      })
    })
  }

  const toggleChunk = (chunk: SteeringViewNode) => {
    const hunks = hunksOf(chunk)
    const target = !(hunks.length > 0 && hunks.every(isChecked))
    // Local-only by design — see package 04's own "Deliberately deferred to a
    // later package" note under T4 for why ticks aren't wired to writeNote.
    setTicked((prev) => {
      const next = { ...prev }
      for (const hunk of hunks) next[hunkKey(hunk.anchor)] = target
      return next
    })
  }

  const setHunkChecked = (hunk: SteeringViewNode, checked: boolean) => {
    // Local-only by design — see package 04's own "Deliberately deferred to a
    // later package" note under T4 for why ticks aren't wired to writeNote.
    setTicked((prev) => ({ ...prev, [hunkKey(hunk.anchor)]: checked }))
  }

  const openChunk = (index: number) => {
    scroll.capture()
    setOpenChunkIndex(index)
    setDeckIndex(0)
  }

  /** Both the chunk-deck's own `onExit` (back from the first hunk) and the last-hunk-approved path below route through this, so scroll position is restored on either exit, not just an explicit back tap. */
  const exitToChunkList = () => {
    setOpenChunkIndex(undefined)
    scroll.restore()
  }

  const approveAndAdvance = (hunks: readonly SteeringViewNode[]) => {
    const next = deckIndex + 1
    if (next >= hunks.length) {
      exitToChunkList()
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
    exitToChunkList,
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

/** Fetches ONE hunk's own diff live via `trpc.diff` (`Server.ts`'s `diff` procedure → `Diff.ts#resolveDiff`) — only ever mounted for the deck's CURRENT item (`Deck.tsx` renders one item at a time), so this is one query per screen, not one per hunk in the chunk. Disabled when the hunk carries no `path` at all (never expected in practice — every review hunk has one — but guards against an ever-loading query on malformed data instead of a crash). */
const HunkWithDiff = ({
  worktreePath,
  node,
  ...rest
}: Omit<HunkProps, "diff"> & { readonly worktreePath: string }) => {
  const query = trpc.diff.useQuery(
    {
      worktreePath,
      path: node.path ?? "",
      ...(node.line !== undefined ? { line: node.line } : {}),
    },
    { enabled: node.path !== undefined },
  )
  return <Hunk node={node} diff={query.data} {...rest} />
}

/** One hunk's own props, shared by both the test-seam (`diffs` prop) and live-fetch (`worktreePath`) render paths below — `hunks` is the WHOLE chunk's own hunk list (needed by `approveAndAdvance` to know when this is the last one), not just this one item. */
const hunkPropsFor = (
  hunk: SteeringViewNode,
  index: number,
  hunks: readonly SteeringViewNode[],
  state: ReviewState,
): Omit<HunkProps, "diff"> => ({
  node: hunk,
  index,
  total: hunks.length,
  checked: state.isChecked(hunk),
  hasNote: state.hasNoteText(hunk),
  onToggle: (checked) => state.setHunkChecked(hunk, checked),
  onApprove: () => state.approveAndAdvance(hunks),
  onOpenNote: () => state.openNoteSheet(hunk),
})

/** The per-chunk deck of hunks — one hunk per screen, approving the last one exits back to the chunk list via `state.approveAndAdvance`. */
const HunkDeck = ({
  chunk,
  diffs,
  worktreePath,
  state,
}: {
  readonly chunk: SteeringViewNode
  readonly diffs: Readonly<Record<string, DiffResult>> | undefined
  readonly worktreePath: string | undefined
  readonly state: ReviewState
}) => {
  const hunks = hunksOf(chunk)
  return (
    <Deck
      items={hunks}
      index={state.deckIndex}
      onIndexChange={state.setDeckIndex}
      onExit={state.exitToChunkList}
      renderItem={(hunk, i) => {
        const props = hunkPropsFor(hunk, i, hunks, state)
        if (diffs !== undefined) {
          return <Hunk key={hunkKey(hunk.anchor)} {...props} diff={diffs[hunkKey(hunk.anchor)]} />
        }
        if (worktreePath !== undefined) {
          return <HunkWithDiff key={hunkKey(hunk.anchor)} worktreePath={worktreePath} {...props} />
        }
        return <Hunk key={hunkKey(hunk.anchor)} {...props} diff={undefined} />
      }}
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
        disabled={hunks.length === 0}
        style={{
          flex: 1,
          textAlign: "left",
          background: "none",
          border: "none",
          color: "inherit",
          font: "inherit",
          padding: 0,
          cursor: hunks.length === 0 ? "default" : "pointer",
          opacity: hunks.length === 0 ? 0.6 : 1,
        }}
      >
        <div style={{ fontWeight: 600 }}>{chunk.title}</div>
        {chunk.detail !== undefined && chunk.detail.length > 0 && (
          <div style={{ fontSize: 12, opacity: 0.7 }}>{chunk.detail}</div>
        )}
        {hunks.length === 0 && (
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>No file pointers</div>
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
export const ReviewView = ({
  view,
  isLoading,
  diffs,
  worktreePath,
  onSaveNote,
}: ReviewViewProps) => {
  const state = useReviewState(onSaveNote)

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
  // A chunk with zero hunks never opens a deck at all — `Deck.tsx` renders
  // `null` for an empty item list, which would otherwise be an unrecoverable
  // blank dead-end (no content, no Back control). The chunk-open button is
  // already disabled for this shape; this is the defensive backstop for any
  // other path that could still set `openChunkIndex` on one.
  if (openChunk !== undefined && hunksOf(openChunk).length > 0) {
    return <HunkDeck chunk={openChunk} diffs={diffs} worktreePath={worktreePath} state={state} />
  }

  return <ChunkList nodes={view.nodes} state={state} />
}

export interface ReviewProps {
  readonly worktreePath: string
  /** Path to the review steering file, relative to `worktreePath` (`.gtd/REVIEW.md`, typically). */
  readonly filePath: string
}

/**
 * The real review screen: fetches the file's content/`view`/tokens through
 * `readSteeringFile` (never a bare `content` prop with no way to have
 * actually been fetched), and write-throughs a saved note via `writeNote`'s
 * compare-and-swap using the SAME `headSha`/`contentHash` that fetch
 * returned — refetching afterward so a stale local override never
 * outlives the server's own authoritative content. `worktreePath` also
 * threads through to `HunkDeck`'s live `trpc.diff` fetch (never the `diffs`
 * test-seam prop, which only `Review.stories.tsx` uses). Not yet imported by
 * `App.tsx` — routing between screens is a later package's task, not this
 * one's; `Review.stories.tsx`'s own `RealContainerFetchesTheCurrentHunksDiffLive`
 * story is its one real consumer today.
 */
export const Review = ({ worktreePath, filePath }: ReviewProps) => {
  const utils = trpc.useUtils()
  const query = trpc.readSteeringFile.useQuery({ worktreePath, filePath, mode: "review" })
  const writeNote = trpc.writeNote.useMutation({
    onSettled: () => utils.readSteeringFile.invalidate({ worktreePath, filePath, mode: "review" }),
  })

  const onSaveNote = (anchor: SteeringAnchor, text: string): Promise<unknown> => {
    const data = query.data
    if (data === undefined) return Promise.reject(new Error("no steering file loaded yet"))
    return writeNote.mutateAsync({
      worktreePath,
      filePath,
      expectedHeadSha: data.headSha,
      expectedContentHash: data.contentHash,
      mode: "review",
      anchor,
      text,
    })
  }

  return (
    <ReviewView
      view={query.data?.view}
      isLoading={query.isLoading}
      worktreePath={worktreePath}
      onSaveNote={onSaveNote}
    />
  )
}
