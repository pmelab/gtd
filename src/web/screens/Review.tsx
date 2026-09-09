import { useRef, useState, type RefObject } from "react"
import type { SteeringAnchor, SteeringView, SteeringViewNode } from "../../SteeringFormat.js"
import { Button } from "../Button.js"
import { CardList } from "../Card.js"
import { Deck } from "../Deck.js"
import { Notice } from "../Notice.js"
import { NoteSheet } from "../NoteSheet.js"
import { messageForReadRefusal, RefusalBanner, useRefusal } from "../Refusal.js"
import { readRefusalFrom, trpc } from "../api.js"
import { withStaleShaRetry, type CasTokens } from "../staleRetry.js"
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
  /** The `readSteeringFile` query's own thrown error — mirrors `Plan.tsx#PlanViewProps.readError`'s identical doc comment. */
  readonly readError?: unknown
  /**
   * `true` only for the real `Review` container — every hunk screen then
   * fetches its own diff live via `HunkDeck`'s `trpc.diff` call
   * (`Server.ts`'s `diff` procedure, `Diff.ts#resolveDiff` resolve against
   * the one worktree the server serves; no path of any kind travels from
   * this client). `Review.stories.tsx`'s own pure-data stories leave this
   * unset and see `Hunk.tsx`'s permanent "Loading diff…" state instead —
   * every OTHER diff shape (whole-file banner, binary, no-changes, refused)
   * is driven directly at `Hunk.stories.tsx`'s own layer, which takes a
   * `diff` prop straight from the caller with no fetch involved at all.
   */
  readonly live?: boolean
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
  /** The done action (T2): saves the SAME note `onSaveNote` would, then hands the turn back — mirrors `Plan.tsx#PlanViewProps.onDoneNote`'s identical doc comment. Absent in `Review.stories.tsx`'s pure-data stories, exactly like `onSaveNote`. */
  readonly onDoneNote?: (anchor: SteeringAnchor, text: string) => Promise<unknown>
  /**
   * Write-through for a hunk/chunk tick (package 03): the real `Review`
   * container wires this to `trpc.setValue.mutateAsync` (invalidating
   * `readSteeringFile` on settle), the exact SAME compare-and-swap `onSaveNote`
   * uses for a note, just calling `SteeringFormat.apply` server-side instead
   * of `annotate`. `useReviewState`'s `ticked` map stays optimistic/local
   * either way — this is the write-through ALONGSIDE it, mirroring
   * `saveNote`'s own revert-on-rejection pattern. Absent in
   * `Review.stories.tsx`'s pure-data stories, exactly like `onSaveNote`.
   */
  readonly onSetValue?: (anchor: SteeringAnchor, checked: boolean) => Promise<unknown>
  /**
   * Every write refusal this screen's mutations surface (package 03 Task 1)
   * — the same `RefusalBanner` the real `Review` container mounts above
   * this view shows a named reason instead of the write silently reverting.
   * The optional second argument (task 01) mirrors
   * `Plan.tsx#PlanViewProps.onRefusal`'s identical doc comment — see that
   * for why `saveNote`/`autoSaveNote`/`toggleChunk`/`setHunkChecked` below
   * each supply one and `doneNote` doesn't. Absent in `Review.stories.tsx`'s
   * pure-data stories.
   */
  readonly onRefusal?: (error: unknown, retry?: () => Promise<unknown>) => void
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
 * `ticked`'s local map stays optimistic/tap-responsive UI state, exactly like
 * `notes` below, but both `toggleChunk` and `setHunkChecked` ALSO write
 * through via `onSetValue` (when the container supplies one) — `apply` is
 * `SteeringFormat`'s format-agnostic tick primitive, splicing through
 * `writeValue`'s compare-and-swap the same way `annotate` does for a note.
 */
const useReviewState = (
  scrollRef: RefObject<HTMLDivElement | null>,
  onSaveNote?: (anchor: SteeringAnchor, text: string) => Promise<unknown>,
  onDoneNote?: (anchor: SteeringAnchor, text: string) => Promise<unknown>,
  onSetValue?: (anchor: SteeringAnchor, checked: boolean) => Promise<unknown>,
  onRefusal?: (error: unknown, retry?: () => Promise<unknown>) => void,
) => {
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [openChunkIndex, setOpenChunkIndex] = useState<number | undefined>(undefined)
  const [deckIndex, setDeckIndex] = useState(0)
  const [noteSheet, setNoteSheet] = useState<NoteSheetState | undefined>(undefined)
  const scroll = useScrollRestoration()

  /**
   * Per-hunk-key write sequence numbers (package 03 Task 7) — mirrors
   * `Question.tsx`'s identical `seqRef`. A REJECTED tick only reverts a
   * hunk's local state when it's still the LATEST write issued for that same
   * hunk key; a whole-state `previous` snapshot (the previous scheme) would
   * instead clobber whatever a later, already-issued tick on a DIFFERENT
   * hunk had just done. Held in a ref (never `useState`): bumping it must
   * never itself trigger a render. `toggleChunk` bumps one seq per hunk
   * beneath the chunk (one write, many keys); `setHunkChecked` bumps just
   * its own key.
   */
  const seqRef = useRef(new Map<string, number>())
  const nextSeqFor = (key: string): number => {
    const seq = (seqRef.current.get(key) ?? 0) + 1
    seqRef.current.set(key, seq)
    return seq
  }

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
    onSaveNote?.(anchor, text)?.catch((error: unknown) => {
      // `onSaveNote` is surely defined here — this `.catch` only runs off a
      // promise `onSaveNote?.(...)` itself returned.
      onRefusal?.(error, () => onSaveNote(anchor, text))
      setNotes((prev) => {
        const next = { ...prev }
        delete next[noteKey(anchor)]
        return next
      })
    })
  }

  /** Debounced/unmount write-through (package 03 Task 5) — same optimistic update and revert-on-rejection as `saveNote`, but never dismisses the sheet: `NoteSheet`'s own `onAutoSave`, not a second `onSave`. */
  const autoSaveNote = (anchor: SteeringAnchor, text: string): Promise<unknown> => {
    setNotes((prev) => ({ ...prev, [noteKey(anchor)]: text }))
    return (
      onSaveNote?.(anchor, text)?.catch((error: unknown) => {
        onRefusal?.(error, () => onSaveNote(anchor, text))
        setNotes((prev) => {
          const next = { ...prev }
          delete next[noteKey(anchor)]
          return next
        })
        // Rethrown, unlike `saveNote`'s own identical wrapper — the caller
        // is `NoteSheet.tsx`'s own `runAutoSave`, which rolls its
        // `lastAutoSavedRef` back to retry ONLY on a rejection; swallowing
        // it here would leave that ref pointing at text that was never
        // actually written, permanently skipping every later debounce/
        // blur/unmount commit for this same text.
        throw error
      }) ?? Promise.resolve()
    )
  }

  /** The done action's own trigger — same optimistic-note update `saveNote` does, then `onDoneNote` (never both: this is `NoteSheet`'s "Save & Done", not a second save). */
  const doneNote = (anchor: SteeringAnchor, text: string) => {
    setNotes((prev) => ({ ...prev, [noteKey(anchor)]: text }))
    setNoteSheet(undefined)
    onDoneNote?.(anchor, text)
  }

  const toggleChunk = (chunk: SteeringViewNode) => {
    const hunks = hunksOf(chunk)
    const target = !(hunks.length > 0 && hunks.every(isChecked))
    const previous = new Map(hunks.map((hunk) => [hunkKey(hunk.anchor), isChecked(hunk)]))
    const issuedSeqs = new Map(
      hunks.map((hunk) => [hunkKey(hunk.anchor), nextSeqFor(hunkKey(hunk.anchor))]),
    )
    // Every hunk beneath the chunk updates locally for immediate feedback,
    // but the write-through below is ONE `setValue` call at the chunk anchor
    // — `REVIEW_FORMAT.apply` ticks every hunk beneath it server-side in one
    // edit set, so a call per hunk would be redundant network traffic, not
    // just slower.
    setTicked((prev) => {
      const next = { ...prev }
      for (const hunk of hunks) next[hunkKey(hunk.anchor)] = target
      return next
    })
    onSetValue?.(chunk.anchor, target)?.catch((error: unknown) => {
      onRefusal?.(error, () => onSetValue(chunk.anchor, target))
      setTicked((prev) => {
        const next = { ...prev }
        for (const hunk of hunks) {
          const key = hunkKey(hunk.anchor)
          // Only revert a hunk still on THIS write's own seq — a later,
          // already-issued tick on the same hunk (`setHunkChecked`, or
          // another `toggleChunk`) bumped it past `issuedSeqs`, so this
          // stale rejection must leave it standing.
          if (seqRef.current.get(key) === issuedSeqs.get(key)) {
            next[key] = previous.get(key) ?? false
          }
        }
        return next
      })
    })
  }

  const setHunkChecked = (hunk: SteeringViewNode, checked: boolean) => {
    const key = hunkKey(hunk.anchor)
    const seq = nextSeqFor(key)
    setTicked((prev) => ({ ...prev, [key]: checked }))
    // A refused/failed write reverts the optimistic tick — mirrors `saveNote`'s
    // own revert-on-rejection above — but only when this write is still the
    // latest issued for `key` (Task 7), so a stale rejection can never
    // clobber a newer, already-landed tick on the same hunk.
    onSetValue?.(hunk.anchor, checked)?.catch((error: unknown) => {
      onRefusal?.(error, () => onSetValue(hunk.anchor, checked))
      if (seqRef.current.get(key) === seq) {
        setTicked((prev) => ({ ...prev, [key]: !checked }))
      }
    })
  }

  const openChunk = (index: number) => {
    scroll.capture(scrollRef)
    setOpenChunkIndex(index)
    setDeckIndex(0)
  }

  /** Both the chunk-deck's own `onExit` (back from the first hunk) and the last-hunk-approved path below route through this, so scroll position is restored on either exit, not just an explicit back tap. */
  const exitToChunkList = () => {
    setOpenChunkIndex(undefined)
    scroll.restore(scrollRef)
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
    autoSaveNote,
    doneNote,
    toggleChunk,
    setHunkChecked,
    openChunk,
    approveAndAdvance,
  }
}

type ReviewState = ReturnType<typeof useReviewState>

/** Fetches ONE hunk's own diff live via `trpc.diff` (`Server.ts`'s `diff` procedure → `Diff.ts#resolveDiff`) — only ever mounted for the deck's CURRENT item (`Deck.tsx` renders one item at a time), so this is one query per screen, not one per hunk in the chunk. Disabled when the hunk carries no `path` at all (never expected in practice — every review hunk has one — but guards against an ever-loading query on malformed data instead of a crash). */
const HunkWithDiff = ({ node, ...rest }: Omit<HunkProps, "diff">) => {
  const query = trpc.diff.useQuery(
    {
      path: node.path ?? "",
      ...(node.line !== undefined ? { line: node.line } : {}),
    },
    { enabled: node.path !== undefined },
  )
  return <Hunk node={node} diff={query.data} {...rest} />
}

/** One hunk's own props — `hunks` is the WHOLE chunk's own hunk list (needed by `approveAndAdvance` to know when this is the last one), not just this one item. */
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

/** The per-chunk deck of hunks — one hunk per screen, approving the last one exits back to the chunk list via `state.approveAndAdvance`. Renders `HunkWithDiff` (a live `trpc.diff` fetch) when `live` is set — the real `Review` container always sets it — else a plain `Hunk` stuck permanently on `diff={undefined}`'s "Loading diff…" state, which is exactly what `Review.stories.tsx`'s own pure-data stories exercise. */
const HunkDeck = ({
  chunk,
  live,
  state,
}: {
  readonly chunk: SteeringViewNode
  readonly live: boolean
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
        if (live) {
          return <HunkWithDiff key={hunkKey(hunk.anchor)} {...props} />
        }
        return <Hunk key={hunkKey(hunk.anchor)} {...props} diff={undefined} />
      }}
    />
  )
}

/** One chunk's own row: prose, a check-all tick over every one of its hunks (nested at any depth), and its note affordance — including the badge that keeps the round open when a footnote is attached, even fully ticked. */
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
    <div data-testid={`chunk-card-${chunkIndex}`} className="flex items-start gap-2 px-3 py-2.5">
      <input
        type="checkbox"
        data-testid={`chunk-check-all-${chunkIndex}`}
        checked={allChecked}
        disabled={hunks.length === 0}
        onChange={() => state.toggleChunk(chunk)}
      />
      <Button
        variant="ghost"
        data-testid={`chunk-open-${chunkIndex}`}
        onClick={() => state.openChunk(chunkIndex)}
        disabled={hunks.length === 0}
        className="flex-1 text-left disabled:opacity-60"
      >
        <div className="font-semibold">{chunk.title}</div>
        {chunk.detail !== undefined && chunk.detail.length > 0 && (
          <div className="text-small text-muted">{chunk.detail}</div>
        )}
        {hunks.length === 0 && <div className="mt-0.5 text-small text-muted">No file pointers</div>}
        {footnoteKeepsRoundOpen && (
          <div
            data-testid={`chunk-footnote-badge-${chunkIndex}`}
            className="mt-1 text-small text-[#e0a030]"
          >
            Note keeps this round open
          </div>
        )}
      </Button>
      <Button
        variant="secondary"
        data-testid={`chunk-note-${chunkIndex}`}
        onClick={() => state.openNoteSheet(chunk)}
      >
        {state.hasNoteText(chunk) ? "Edit note" : "Note"}
      </Button>
    </div>
  )
}

/** The chunk list itself — one `ChunkRow` per top-level node. */
const ChunkList = ({
  nodes,
  state,
  scrollRef,
}: {
  readonly nodes: SteeringView["nodes"]
  readonly state: ReviewState
  readonly scrollRef: RefObject<HTMLDivElement | null>
}) => (
  <div data-testid="review-screen" className="flex h-full min-h-0 flex-1 flex-col">
    <div
      ref={scrollRef}
      data-testid="review-scroll-container"
      className="min-h-0 flex-1 overflow-auto"
    >
      <CardList>
        {nodes.map((chunk, chunkIndex) => (
          <ChunkRow key={chunkIndex} chunk={chunk} chunkIndex={chunkIndex} state={state} />
        ))}
      </CardList>
    </div>
  </div>
)

/**
 * Presentational review screen — chunk list drilling into a per-chunk deck
 * of hunks, mirroring `Plan.tsx`'s `PlanView`/`Plan` split so
 * `Review.stories.tsx` can drive every shape with plain `view` data. Itself
 * just a thin dispatch over the note sheet / hunk deck / chunk list branches
 * — the state and per-branch markup live in `useReviewState`/`HunkDeck`/
 * `ChunkList` above.
 */
// fallow-ignore-next-line complexity
export const ReviewView = ({
  view,
  isLoading,
  readError,
  live,
  onSaveNote,
  onDoneNote,
  onSetValue,
  onRefusal,
}: ReviewViewProps) => {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const state = useReviewState(scrollRef, onSaveNote, onDoneNote, onSetValue, onRefusal)

  if (view === undefined) {
    const refusal = readError !== undefined ? readRefusalFrom(readError) : undefined
    return (
      <Notice tone={isLoading ? "info" : "error"}>
        {isLoading
          ? "Loading the review…"
          : refusal !== undefined
            ? messageForReadRefusal(refusal)
            : "Could not load the review."}
      </Notice>
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
        onAutoSave={state.autoSaveNote}
        onDismiss={() => state.setNoteSheet(undefined)}
        {...(onDoneNote !== undefined ? { onDone: state.doneNote } : {})}
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
    return <HunkDeck chunk={openChunk} live={live === true} state={state} />
  }

  return <ChunkList nodes={view.nodes} state={state} scrollRef={scrollRef} />
}

/**
 * The terminal panel after `done` resolves (T2): the server has already
 * written the note and called `ctx.handOff()`, so the process exits moments
 * later — this needs no further server round trip, and offers no way back to
 * any list. Identical in shape to `Plan.tsx#HandedBackPanel`; kept as two
 * small copies rather than a shared import since each screen owns its own
 * file per this package's declared scope.
 */
const HandedBackPanel = () => (
  <Notice data-testid="handed-back-panel" role="status" aria-live="polite">
    Handed back — this turn is done.
  </Notice>
)

export interface ReviewProps {
  /** Path to the review steering file, relative to the served worktree (`.gtd/REVIEW.md`, typically). */
  readonly filePath: string
}

/**
 * The real review screen: fetches the file's content/`view`/tokens through
 * `readSteeringFile` (never a bare `content` prop with no way to have
 * actually been fetched), and write-throughs a saved note via `writeNote`'s
 * compare-and-swap using the SAME `headSha`/`contentHash` that fetch
 * returned — refetching afterward so a stale local override never
 * outlives the server's own authoritative content. Always passes
 * `live={true}` down (`HunkDeck`'s live `trpc.diff` fetch): `App.tsx`
 * renders this when `trpc.step`'s own `mode` is `"review"`;
 * `Review.stories.tsx`'s own `RealContainerFetchesTheCurrentHunksDiffLive`
 * story is its other real consumer.
 */
export const Review = ({ filePath }: ReviewProps) => {
  const { refusal, saveStatus, showRefusal, dismiss, trackSave, onRetry } = useRefusal()
  const utils = trpc.useUtils()
  const query = trpc.readSteeringFile.useQuery({ filePath, mode: "review" })
  const writeNote = trpc.writeNote.useMutation({
    onSettled: () => utils.readSteeringFile.invalidate({ filePath, mode: "review" }),
  })
  const setValue = trpc.setValue.useMutation({
    onSettled: () => utils.readSteeringFile.invalidate({ filePath, mode: "review" }),
  })
  const done = trpc.done.useMutation()

  // `fetch`, never `invalidate` — mirrors `Plan.tsx#usePlanMutations`'s
  // identical `refetchTokens`/doc comment: the retry needs the fresh tokens
  // back as a value, and `onSettled`'s own `invalidate` above already
  // populates the same cache entry, so the two don't fight.
  const refetchTokens = async (): Promise<CasTokens> => {
    const fresh = await utils.readSteeringFile.fetch({ filePath, mode: "review" })
    return { expectedHeadSha: fresh.headSha, expectedContentHash: fresh.contentHash }
  }

  const casTokensFor = (): CasTokens | undefined => {
    const data = query.data
    return data === undefined
      ? undefined
      : { expectedHeadSha: data.headSha, expectedContentHash: data.contentHash }
  }

  const onSetValue = (anchor: SteeringAnchor, checked: boolean): Promise<unknown> => {
    const tokens = casTokensFor()
    if (tokens === undefined) return Promise.reject(new Error("no steering file loaded yet"))
    return withStaleShaRetry(
      (cas) => setValue.mutateAsync({ filePath, ...cas, mode: "review", anchor, checked }),
      tokens,
      refetchTokens,
    )
  }

  const onSaveNote = (anchor: SteeringAnchor, text: string): Promise<unknown> => {
    const tokens = casTokensFor()
    if (tokens === undefined) return Promise.reject(new Error("no steering file loaded yet"))
    return withStaleShaRetry(
      (cas) => writeNote.mutateAsync({ filePath, ...cas, mode: "review", anchor, text }),
      tokens,
      refetchTokens,
    )
  }

  const onDoneNote = (anchor: SteeringAnchor, text: string): Promise<unknown> => {
    const tokens = casTokensFor()
    if (tokens === undefined) return Promise.reject(new Error("no steering file loaded yet"))
    return withStaleShaRetry(
      (cas) => done.mutateAsync({ filePath, ...cas, mode: "review", anchor, text }),
      tokens,
      refetchTokens,
    ).catch((error: unknown) => {
      // Mirrors `Plan.tsx#Plan`'s identical `onDoneNote` catch — see its
      // own doc comment for why this is caught, not rethrown.
      showRefusal(error)
    })
  }

  // Task 3's "Saving…"/"Saved" affordance — mirrors `Plan.tsx#Plan`'s
  // identical split: wraps only the two write paths a human sits waiting on
  // (a tick, a note save), excluding `onDoneNote` since a successful `done`
  // unmounts this screen for `HandedBackPanel` first.
  const onSetValueTracked = (anchor: SteeringAnchor, checked: boolean): Promise<unknown> =>
    trackSave(onSetValue(anchor, checked))
  const onSaveNoteTracked = (anchor: SteeringAnchor, text: string): Promise<unknown> =>
    trackSave(onSaveNote(anchor, text))

  return (
    <>
      <RefusalBanner
        refusal={refusal}
        saveStatus={saveStatus}
        onDismiss={dismiss}
        onRetry={onRetry}
      />
      {done.isSuccess ? (
        // Once `done` resolves, the server has already written the note and
        // called `ctx.handOff()` — the process exits moments later, so
        // nothing here needs (or can get) another round trip. No screen
        // offers a way back to a list, this included: rendering `ReviewView`
        // past this point would let a human tap into a chunk/hunk whose
        // write can never land.
        <HandedBackPanel />
      ) : (
        <ReviewView
          view={query.data?.view}
          isLoading={query.isLoading}
          readError={query.error}
          live={true}
          onSaveNote={onSaveNoteTracked}
          onDoneNote={onDoneNote}
          onSetValue={onSetValueTracked}
          onRefusal={showRefusal}
        />
      )}
    </>
  )
}
