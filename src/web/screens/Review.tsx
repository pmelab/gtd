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
 * Presentational review screen — chunk list drilling into a per-chunk deck
 * of hunks, mirroring `Plan.tsx`'s `PlanView`/`Plan` split so
 * `Review.stories.tsx` can drive every shape with plain `view` data.
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
export const ReviewView = ({ view, isLoading, diffs }: ReviewViewProps) => {
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [openChunkIndex, setOpenChunkIndex] = useState<number | undefined>(undefined)
  const [deckIndex, setDeckIndex] = useState(0)
  const [noteSheet, setNoteSheet] = useState<NoteSheetState | undefined>(undefined)

  if (isLoading && view === undefined) {
    return <div style={{ padding: 16 }}>Loading the review…</div>
  }
  if (view === undefined) {
    return <div style={{ padding: 16 }}>Could not load the review.</div>
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

  if (noteSheet !== undefined) {
    return (
      <NoteSheet
        anchor={noteSheet.anchor}
        {...(noteSheet.initialNote !== undefined ? { note: noteSheet.initialNote } : {})}
        onSave={saveNote}
        onDismiss={() => setNoteSheet(undefined)}
      />
    )
  }

  if (openChunkIndex !== undefined) {
    const chunk = view.nodes[openChunkIndex]
    const hunks = chunk !== undefined ? hunksOf(chunk) : []
    return (
      <Deck
        items={hunks}
        index={deckIndex}
        onIndexChange={setDeckIndex}
        onExit={() => setOpenChunkIndex(undefined)}
        renderItem={(hunk, i) => (
          <Hunk
            key={hunkKey(hunk.anchor)}
            node={hunk}
            diff={diffs?.[hunkKey(hunk.anchor)]}
            index={i}
            total={hunks.length}
            checked={isChecked(hunk)}
            hasNote={hasNoteText(hunk)}
            onToggle={(checked) => setHunkChecked(hunk, checked)}
            onApprove={() => approveAndAdvance(hunks)}
            onOpenNote={() => openNoteSheet(hunk)}
          />
        )}
      />
    )
  }

  return (
    <div data-testid="review-screen" style={{ maxWidth: 390, margin: "0 auto" }}>
      <CardList>
        {view.nodes.map((chunk, chunkIndex) => {
          const hunks = hunksOf(chunk)
          const allChecked = hunks.length > 0 && hunks.every(isChecked)
          const footnoteKeepsRoundOpen = hasNoteText(chunk)
          return (
            <div
              key={chunkIndex}
              data-testid={`chunk-card-${chunkIndex}`}
              style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px" }}
            >
              <input
                type="checkbox"
                data-testid={`chunk-check-all-${chunkIndex}`}
                checked={allChecked}
                disabled={hunks.length === 0}
                onChange={() => toggleChunk(chunk)}
              />
              <button
                type="button"
                data-testid={`chunk-open-${chunkIndex}`}
                onClick={() => openChunk(chunkIndex)}
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
                onClick={() => openNoteSheet(chunk)}
              >
                {hasNoteText(chunk) ? "Edit note" : "Note"}
              </button>
            </div>
          )
        })}
      </CardList>
    </div>
  )
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
