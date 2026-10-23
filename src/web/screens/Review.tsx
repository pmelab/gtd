import { useRef, useState, type RefObject } from "react"
import type {
  SteeringAnchor,
  SteeringView,
  SteeringViewNode,
  SteeringViewThread,
} from "../../steering/index.js"
import { FREE_TEXT_PLACEHOLDER, isAnswered } from "../../steering/index.js"
import { Button } from "../Button.js"
import { cn } from "../cn.js"
import { CardList } from "../Card.js"
import { Deck } from "../Deck.js"
import { FormatNoticeBanner, type FormatNotice } from "../FormatNotice.js"
import { Notice } from "../Notice.js"
import { NoteSheet } from "../NoteSheet.js"
import { existingNoteFor, withReply } from "../notes.js"
import { messageForReadRefusal, SaveIndicator, useSaveIndicatorProps } from "../Refusal.js"
import { Thread } from "../Thread.js"
import { readRefusalFrom, trpc } from "../api.js"
import type { CasTokens } from "../staleRetry.js"
import { useScrollRestoration } from "../useScrollRestoration.js"
import { cellKey, latestOverlayValue, useWriteStore, WriteStoreProvider } from "../writeStore.js"
import { Hunk, type HunkProps } from "./Hunk.js"
import { Inline } from "./InlineRun.js"

/** A write guarded by the store's own compare-and-swap retry — see `writeStore.ts#SaveArgs.write`'s own doc comment. */
type TokenGuardedWrite = (tokens: CasTokens) => Promise<unknown>

/** Every hunk-anchored descendant of a chunk node, at any depth. */
const hunksOf = (node: SteeringViewNode): readonly SteeringViewNode[] =>
  (node.children ?? []).flatMap((child) => [
    ...(child.anchor.kind === "hunk" ? [child] : []),
    ...hunksOf(child),
  ])

/** A finding's decision as the screen holds it: one overlay cell for the tick and its free text together, as `Question.tsx` does. */
interface Decision {
  readonly selected: number | undefined
  readonly freeText: string
}

/** The free-text slot's index among a finding's three boxes. */
const ANSWER_SLOT = 2

const defaultDecisionFor = ({ decision = [] }: SteeringViewNode): Decision => {
  const ticked = decision.flatMap((option, i) => (option.checked === true ? [i] : []))
  const selected = ticked.length === 1 ? ticked[0] : undefined
  return { selected, freeText: decision[ANSWER_SLOT]?.title ?? "" }
}

const normalizeAnswerText = (text: string): string => {
  const trimmed = text.trim()
  return trimmed.toLowerCase() === FREE_TEXT_PLACEHOLDER.toLowerCase() ? "" : trimmed
}

export interface ReviewViewProps {
  readonly view: SteeringView | undefined
  readonly filePath: string
  readonly isLoading: boolean
  readonly readError?: unknown
  /** `true` only for the real container, where every hunk screen fetches its own diff live. */
  readonly live?: boolean
  readonly onSaveNote?: (anchor: SteeringAnchor, text: string) => TokenGuardedWrite
  readonly onDoneNote?: (anchor: SteeringAnchor, text: string) => TokenGuardedWrite
  readonly onDone?: () => Promise<unknown>
  readonly onSetValue?: (anchor: SteeringAnchor, checked: boolean) => TokenGuardedWrite
  /** Writes a finding's decision: one box ticked (radio), and the free-text slot's answer with it. */
  readonly onCommitDecision?: (
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ) => TokenGuardedWrite
  /** Package 03 Task 1's single `busy` boolean, threaded from the store's own pending count. */
  readonly busy?: boolean | undefined
}

/** `{anchor, initialNote}` captured at the moment a note affordance opens `NoteSheet`. */
interface NoteSheetState {
  readonly anchor: SteeringAnchor
  readonly initialNote: string | undefined
}

/**
 * All of `ReviewView`'s local/optimistic UI state plus the derived helpers
 * every branch below needs. `ticked`/notes read straight off the write
 * store's own overlay (keyed by `cellKey`), so a rollback on a refused write
 * falls back to the node's own last-server-confirmed value automatically —
 * no local `useState`, no per-hunk seq guard of its own.
 */
const useReviewState = (
  filePath: string,
  scrollRef: RefObject<HTMLDivElement | null>,
  onSaveNote?: (anchor: SteeringAnchor, text: string) => TokenGuardedWrite,
  onDoneNote?: (anchor: SteeringAnchor, text: string) => TokenGuardedWrite,
  onSetValue?: (anchor: SteeringAnchor, checked: boolean) => TokenGuardedWrite,
  onCommitDecision?: ReviewViewProps["onCommitDecision"],
) => {
  const overlay = useWriteStore((s) => s.overlay)
  const save = useWriteStore((s) => s.save)
  const shadow = useWriteStore((s) => s.shadow)
  const [openChunkIndex, setOpenChunkIndex] = useState<number | undefined>(undefined)
  const [deckIndex, setDeckIndex] = useState(0)
  const [noteSheet, setNoteSheet] = useState<NoteSheetState | undefined>(undefined)
  const [answerSheet, setAnswerSheet] = useState<SteeringViewNode | undefined>(undefined)
  const scroll = useScrollRestoration()

  const checkedCell = (anchor: SteeringAnchor): string => cellKey(filePath, anchor, "checked")
  const noteCell = (anchor: SteeringAnchor): string => cellKey(filePath, anchor, "note")
  const doneCell = (anchor: SteeringAnchor): string => cellKey(filePath, anchor, "done")

  const decisionCell = (chunk: SteeringViewNode): string =>
    cellKey(filePath, chunk.anchor, "decision")

  const decisionOf = (chunk: SteeringViewNode): Decision =>
    (overlay[decisionCell(chunk)]?.value as Decision | undefined) ?? defaultDecisionFor(chunk)

  /** The same rule the landing's `answer-completeness` check applies: three boxes, one ticked, a ticked answer filled in. */
  const isDecided = (chunk: SteeringViewNode): boolean => {
    const options = chunk.decision ?? []
    const { selected, freeText } = decisionOf(chunk)
    return (
      options.length === 3 &&
      isAnswered(
        options.map((option, i) => ({
          checked: selected === i,
          text: i === ANSWER_SLOT ? normalizeAnswerText(freeText) : option.title,
          freeText: i === ANSWER_SLOT,
        })),
      )
    )
  }

  const writeDecision = (
    chunk: SteeringViewNode,
    index: number,
    optimistic: Decision,
    opts: { readonly checked: boolean; readonly text?: string },
  ) => {
    const anchor = chunk.decision?.[index]?.anchor
    if (anchor === undefined) return
    save({
      cell: decisionCell(chunk),
      optimistic,
      write: onCommitDecision === undefined ? undefined : onCommitDecision(anchor, opts),
    }).catch(() => {})
  }

  const chooseDecision = (chunk: SteeringViewNode, index: number) =>
    writeDecision(chunk, index, { ...decisionOf(chunk), selected: index }, { checked: true })

  /** A Save in the answer sheet: an empty answer unticks the slot rather than ticking a blank one. */
  const commitAnswer = (chunk: SteeringViewNode, text: string) => {
    setAnswerSheet(undefined)
    const answer = normalizeAnswerText(text)
    const { selected } = decisionOf(chunk)
    const kept = selected === ANSWER_SLOT ? undefined : selected
    writeDecision(
      chunk,
      ANSWER_SLOT,
      { selected: answer === "" ? kept : ANSWER_SLOT, freeText: answer },
      { checked: answer !== "", text: answer },
    )
  }

  const isChecked = (hunk: SteeringViewNode): boolean =>
    (overlay[checkedCell(hunk.anchor)]?.value as boolean | undefined) ?? hunk.checked === true

  /** Reads BOTH a plain save's own `"note"` cell and that same anchor's `"done"` cell (a Save & Done) — only one of the two is ever written per interaction, so whichever is newer is what should show. */
  const savedNoteOf = (node: SteeringViewNode): string | undefined =>
    latestOverlayValue(overlay, [noteCell(node.anchor), doneCell(node.anchor)]) as
      | string
      | undefined

  /** A thread never renders as flat text: `noteTextOf` is `undefined` for one, `threadOf` carries it (with an optimistic reply applied). */
  const threadOf = (node: SteeringViewNode): SteeringViewThread | undefined => {
    if (node.thread === undefined) return undefined
    const saved = savedNoteOf(node)
    return saved === undefined ? node.thread : withReply(node.thread, saved)
  }

  const noteTextOf = (node: SteeringViewNode): string | undefined =>
    node.thread === undefined ? (savedNoteOf(node) ?? node.note) : undefined

  const hasNoteText = (node: SteeringViewNode): boolean => {
    if (node.thread !== undefined) return true
    const text = noteTextOf(node)
    return text !== undefined && text.length > 0
  }

  const openNoteSheet = (node: SteeringViewNode) =>
    setNoteSheet({
      anchor: node.anchor,
      initialNote: existingNoteFor([node], node.anchor, {}) ?? noteTextOf(node),
    })

  const saveNote = (anchor: SteeringAnchor, text: string) => {
    setNoteSheet(undefined)
    save({
      cell: noteCell(anchor),
      optimistic: text,
      write: onSaveNote === undefined ? undefined : onSaveNote(anchor, text),
    }).catch(() => {})
  }

  /** The done action's own trigger — same optimistic note update `saveNote` does, then `onDoneNote`. Its own `/done` cell, never the plain save's `"note"` cell — a failed `onDoneNote` and a failed `onSaveNote` for the SAME anchor must file two distinct dots, never collide into one. */
  const doneNote = (anchor: SteeringAnchor, text: string) => {
    setNoteSheet(undefined)
    save({
      cell: doneCell(anchor),
      optimistic: text,
      write: onDoneNote === undefined ? undefined : onDoneNote(anchor, text),
    }).catch(() => {})
  }

  // fallow-ignore-next-line complexity
  const toggleChunk = (chunk: SteeringViewNode) => {
    const hunks = hunksOf(chunk)
    const target = !(hunks.length > 0 && hunks.every(isChecked))
    // Every hunk beneath the chunk shows the SAME optimistic tick, but the
    // write-through is ONE `setValue` call at the chunk anchor —
    // `REVIEW_FORMAT.apply` ticks every hunk beneath it server-side in one
    // edit set. Only the FIRST hunk's own cell goes through `save` (the real
    // `write`, the one failed dot, the one pending count); every other
    // hunk's own cell `shadow`s that SAME promise — it mirrors the optimistic
    // tick and rolls back on the same rejection, but never files its own
    // `failed` entry. One refused write is one dot, never one per hunk.
    const [first, ...rest] = hunks
    if (first === undefined) return
    const firstPromise = save({
      cell: checkedCell(first.anchor),
      optimistic: target,
      write: onSetValue === undefined ? undefined : onSetValue(chunk.anchor, target),
    })
    firstPromise.catch(() => {})
    for (const hunk of rest) {
      shadow(checkedCell(hunk.anchor), target, firstPromise)
    }
  }

  const setHunkChecked = (hunk: SteeringViewNode, checked: boolean) => {
    save({
      cell: checkedCell(hunk.anchor),
      optimistic: checked,
      write: onSetValue === undefined ? undefined : onSetValue(hunk.anchor, checked),
    }).catch(() => {})
  }

  const openChunk = (index: number) => {
    scroll.capture(scrollRef)
    setOpenChunkIndex(index)
    setDeckIndex(0)
  }

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
    answerSheet,
    setAnswerSheet,
    exitToChunkList,
    decisionOf,
    isDecided,
    chooseDecision,
    commitAnswer,
    isChecked,
    hasNoteText,
    noteTextOf,
    threadOf,
    openNoteSheet,
    saveNote,
    doneNote,
    toggleChunk,
    setHunkChecked,
    openChunk,
    approveAndAdvance,
  }
}

type ReviewState = ReturnType<typeof useReviewState>

/** Fetches ONE hunk's own diff live via `trpc.diff`. */
const HunkWithDiff = ({ node, ...rest }: Omit<HunkProps, "diff">) => {
  const query = trpc.diff.useQuery(
    {
      path: node.path ?? "",
      ...(node.line !== undefined ? { line: node.line } : {}),
      ...(node.endLine !== undefined ? { endLine: node.endLine } : {}),
    },
    { enabled: node.path !== undefined },
  )
  return <Hunk node={node} diff={query.data} {...rest} />
}

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
  ...(state.noteTextOf(hunk) !== undefined ? { note: state.noteTextOf(hunk)! } : {}),
  ...(state.threadOf(hunk) !== undefined ? { thread: state.threadOf(hunk)! } : {}),
  onToggle: (checked) => state.setHunkChecked(hunk, checked),
  onApprove: () => state.approveAndAdvance(hunks),
  onOpenNote: () => state.openNoteSheet(hunk),
})

const HunkDeck = ({
  chunk,
  live,
  state,
  onDone,
  busy,
  undecided,
}: {
  readonly chunk: SteeringViewNode
  readonly live: boolean
  readonly state: ReviewState
  readonly onDone: (() => void) | undefined
  readonly busy?: boolean | undefined
  readonly undecided: number
}) => {
  const hunks = hunksOf(chunk)
  return (
    <div data-testid="hunk-deck" className="flex h-full min-h-0 flex-1 flex-col">
      <Deck
        items={hunks}
        index={state.deckIndex}
        onIndexChange={state.setDeckIndex}
        onExit={state.exitToChunkList}
        {...(onDone !== undefined
          ? { onDone, doneLabel: "Done", doneDisabled: busy === true || undecided > 0 }
          : {})}
        renderItem={(hunk, i) => {
          const props = hunkPropsFor(hunk, i, hunks, state)
          if (live) {
            return <HunkWithDiff key={`${hunk.anchor.kind}:${i}`} {...props} />
          }
          return <Hunk key={`${hunk.anchor.kind}:${i}`} {...props} diff={undefined} />
        }}
      />
    </div>
  )
}

const DECISION_LABELS = ["Fix as suggested", "Won't fix", "Your answer"]

/** A finding's decision: three radios, the last opening the answer sheet. */
// fallow-ignore-next-line complexity
const DecisionControl = ({
  chunk,
  chunkIndex,
  state,
}: {
  readonly chunk: SteeringViewNode
  readonly chunkIndex: number
  readonly state: ReviewState
}) => {
  const { selected, freeText } = state.decisionOf(chunk)
  const choose = (i: number) =>
    i === ANSWER_SLOT ? state.setAnswerSheet(chunk) : state.chooseDecision(chunk, i)
  return (
    <fieldset
      data-testid={`chunk-decision-${chunkIndex}`}
      className="m-0 mt-1 flex flex-col border-0 p-0 pl-13"
    >
      <legend className="sr-only">Decision for {chunk.title}</legend>
      {(chunk.decision ?? []).map((option, i) => (
        <label key={i} className="flex min-h-11 items-center gap-3">
          <input
            type="radio"
            name={`decision-${chunkIndex}`}
            data-testid={`chunk-decision-${chunkIndex}-${i}`}
            checked={selected === i}
            onChange={() => choose(i)}
          />
          <span className={selected === i ? "font-medium" : undefined}>
            {DECISION_LABELS[i] ?? option.title}
          </span>
        </label>
      ))}
      <Button
        variant="ghost"
        data-testid={`chunk-decision-answer-${chunkIndex}`}
        onClick={() => state.setAnswerSheet(chunk)}
        className="w-full px-0 pl-7 text-left text-small font-normal text-muted"
      >
        {freeText.trim().length > 0 ? freeText : "Tap to write your answer"}
      </Button>
    </fieldset>
  )
}

/** A chunk with neither hunks nor a decision (`Fixed automatically`, …) is a note to read, not an item to tick. */
const isPlainNote = (chunk: SteeringViewNode): boolean =>
  chunk.decision === undefined && hunksOf(chunk).length === 0

// fallow-ignore-next-line complexity
const ChunkSummary = ({
  chunk,
  chunkIndex,
}: {
  readonly chunk: SteeringViewNode
  readonly chunkIndex: number
}) => (
  <>
    {chunk.status !== undefined && (
      <div
        data-testid={`chunk-severity-${chunkIndex}`}
        className={cn(
          "text-small font-semibold",
          chunk.status.startsWith("critical") ? "text-warning" : "text-muted",
        )}
      >
        {chunk.status}
      </div>
    )}
    <div className="font-semibold">{chunk.title}</div>
    {chunk.detail !== undefined && chunk.detail.length > 0 && (
      <div className="text-small text-muted">
        <Inline inline={chunk.detailInline} fallback={chunk.detail} />
      </div>
    )}
  </>
)

/** A finding's done mark, a walkthrough chunk's tick-all box, nothing for a plain note. */
// fallow-ignore-next-line complexity
const ChunkMark = ({
  chunk,
  chunkIndex,
  state,
}: {
  readonly chunk: SteeringViewNode
  readonly chunkIndex: number
  readonly state: ReviewState
}) => {
  const hunks = hunksOf(chunk)
  if (chunk.decision !== undefined) {
    const decided = state.isDecided(chunk)
    return (
      <div
        data-testid={`chunk-decision-status-${chunkIndex}`}
        aria-label={decided ? "Decided" : "Needs a decision"}
        className={cn(
          "flex min-h-11 min-w-11 shrink-0 items-center justify-center font-semibold",
          decided ? "text-heading-c" : "text-warning",
        )}
      >
        {decided ? "✓" : "●"}
      </div>
    )
  }
  if (hunks.length === 0) return null
  return (
    <label
      data-testid={`chunk-check-all-label-${chunkIndex}`}
      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center"
    >
      <input
        type="checkbox"
        data-testid={`chunk-check-all-${chunkIndex}`}
        checked={hunks.every(state.isChecked)}
        onChange={() => state.toggleChunk(chunk)}
      />
    </label>
  )
}

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
  const footnoteKeepsRoundOpen = state.hasNoteText(chunk)
  return (
    <div data-testid={`chunk-card-${chunkIndex}`} className="border-b border-divider px-3 py-2.5">
      <div className="flex items-start gap-2">
        <ChunkMark chunk={chunk} chunkIndex={chunkIndex} state={state} />
        {isPlainNote(chunk) ? (
          <div data-testid={`chunk-plain-note-${chunkIndex}`} className="flex-1 py-1">
            <ChunkSummary chunk={chunk} chunkIndex={chunkIndex} />
          </div>
        ) : (
          <Button
            variant="ghost"
            data-testid={`chunk-open-${chunkIndex}`}
            onClick={() => state.openChunk(chunkIndex)}
            disabled={hunks.length === 0}
            className="flex-1 text-left"
          >
            <ChunkSummary chunk={chunk} chunkIndex={chunkIndex} />
            {hunks.length === 0 && (
              <div className="mt-0.5 text-small text-muted">No file pointers</div>
            )}
            {footnoteKeepsRoundOpen && (
              <div
                data-testid={`chunk-footnote-badge-${chunkIndex}`}
                className="mt-1 text-small text-warning"
              >
                Note keeps this round open
              </div>
            )}
          </Button>
        )}
        {!footnoteKeepsRoundOpen && (
          <Button
            variant="secondary"
            data-testid={`chunk-note-${chunkIndex}`}
            onClick={() => state.openNoteSheet(chunk)}
          >
            Note
          </Button>
        )}
      </div>
      {chunk.decision !== undefined && (
        <DecisionControl chunk={chunk} chunkIndex={chunkIndex} state={state} />
      )}
      {footnoteKeepsRoundOpen && (
        <Button
          variant="ghost"
          data-testid={`chunk-note-${chunkIndex}`}
          onClick={() => state.openNoteSheet(chunk)}
          className="w-full rounded border border-divider px-2 py-1 text-left text-small font-normal text-muted"
        >
          {state.threadOf(chunk) !== undefined ? (
            <Thread thread={state.threadOf(chunk)!} testId={`chunk-thread-${chunkIndex}`} />
          ) : (
            state.noteTextOf(chunk)
          )}
        </Button>
      )}
    </div>
  )
}

/** A finding is done once decided, any other chunk once every hunk is ticked; a plain note never counts. */
const isChunkDone = (chunk: SteeringViewNode, state: ReviewState): boolean => {
  if (chunk.decision !== undefined) return state.isDecided(chunk)
  const hunks = hunksOf(chunk)
  return hunks.length > 0 && hunks.every(state.isChecked)
}

const undecidedCount = (nodes: SteeringView["nodes"], state: ReviewState): number =>
  nodes.filter((chunk) => chunk.decision !== undefined && !state.isDecided(chunk)).length

/** Consecutive chunks sharing a `group` (the review's Findings / Walkthrough), chunk indexes kept for their anchors. */
const groupsOf = (
  nodes: SteeringView["nodes"],
): readonly {
  readonly title: string | undefined
  readonly chunks: readonly { readonly chunk: SteeringViewNode; readonly chunkIndex: number }[]
}[] =>
  nodes.reduce<
    { title: string | undefined; chunks: { chunk: SteeringViewNode; chunkIndex: number }[] }[]
  >((groups, chunk, chunkIndex) => {
    const last = groups.at(-1)
    if (last !== undefined && last.title === chunk.group) last.chunks.push({ chunk, chunkIndex })
    else groups.push({ title: chunk.group, chunks: [{ chunk, chunkIndex }] })
    return groups
  }, [])

// fallow-ignore-next-line complexity
const ChunkList = ({
  nodes,
  state,
  scrollRef,
  onDone,
  busy,
  undecided,
}: {
  readonly nodes: SteeringView["nodes"]
  readonly state: ReviewState
  readonly scrollRef: RefObject<HTMLDivElement | null>
  readonly onDone: (() => void) | undefined
  readonly busy?: boolean | undefined
  readonly undecided: number
}) => (
  <div data-testid="review-screen" className="flex h-full min-h-0 flex-1 flex-col">
    <div
      data-testid="review-progress"
      className="flex shrink-0 items-baseline justify-between gap-2 border-b border-divider px-3 py-2"
    >
      <h1 className="m-0 text-body font-semibold">Review</h1>
      <span className="text-small text-muted tabular-nums">
        {nodes.filter((chunk) => isChunkDone(chunk, state)).length} /{" "}
        {nodes.filter((chunk) => !isPlainNote(chunk)).length} chunks approved
      </span>
    </div>
    <div
      ref={scrollRef}
      data-testid="review-scroll-container"
      className="min-h-0 flex-1 overflow-auto"
    >
      {groupsOf(nodes).map((group) => (
        <section
          key={group.chunks[0]!.chunkIndex}
          {...(group.title === undefined
            ? {}
            : { "data-testid": `review-section-${group.title.toLowerCase()}` })}
        >
          {group.title !== undefined && (
            <h2 className="m-0 border-b border-divider bg-surface px-3 py-1.5 text-small font-semibold text-muted">
              {group.title}
            </h2>
          )}
          <CardList>
            {group.chunks.map(({ chunk, chunkIndex }) => (
              <ChunkRow key={chunkIndex} chunk={chunk} chunkIndex={chunkIndex} state={state} />
            ))}
          </CardList>
        </section>
      ))}
    </div>
    {onDone !== undefined && (
      <div
        data-testid="review-done-row"
        className="flex shrink-0 items-center justify-end gap-3 border-t border-border p-3"
      >
        {undecided > 0 && (
          <span data-testid="review-done-blocked" className="text-small text-warning">
            {undecided === 1 ? "1 finding needs" : `${undecided} findings need`} a decision
          </span>
        )}
        <Button
          variant="primary"
          data-testid="review-done"
          onClick={onDone}
          disabled={busy === true || undecided > 0}
        >
          Done
        </Button>
      </div>
    )}
  </div>
)

/**
 * Presentational review screen — chunk list drilling into a per-chunk deck
 * of hunks, mirroring `Plan.tsx`'s `PlanView`/`Plan` split.
 */
// fallow-ignore-next-line complexity
export const ReviewView = ({
  view,
  filePath,
  isLoading,
  readError,
  live,
  onSaveNote,
  onDoneNote,
  onDone,
  onSetValue,
  onCommitDecision,
  busy,
}: ReviewViewProps) => {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const save = useWriteStore((s) => s.save)
  const state = useReviewState(
    filePath,
    scrollRef,
    onSaveNote,
    onDoneNote,
    onSetValue,
    onCommitDecision,
  )

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

  const answerChunk = state.answerSheet
  const answerAnchor = answerChunk?.decision?.[ANSWER_SLOT]?.anchor
  const answerSheet =
    answerChunk !== undefined && answerAnchor !== undefined ? (
      <NoteSheet
        anchor={answerAnchor}
        title="Your answer"
        label="Answer text"
        note={state.decisionOf(answerChunk).freeText}
        onSave={(_anchor, text) => state.commitAnswer(answerChunk, text)}
        onDismiss={() => state.setAnswerSheet(undefined)}
      />
    ) : null
  const undecided = undecidedCount(view.nodes, state)

  const noteSheet = ((): React.ReactElement | null => {
    if (state.noteSheet === undefined) return answerSheet
    return (
      <NoteSheet
        anchor={state.noteSheet.anchor}
        {...(state.noteSheet.initialNote !== undefined
          ? { note: state.noteSheet.initialNote }
          : {})}
        onSave={state.saveNote}
        onDismiss={() => state.setNoteSheet(undefined)}
        {...(onDoneNote !== undefined ? { onDone: state.doneNote, busy } : {})}
      />
    )
  })()

  const runDone = (): void => {
    if (onDone === undefined) return
    save({ cell: cellKey(filePath, undefined, "done"), optimistic: true, mutate: onDone }).catch(
      () => {},
    )
  }

  const openChunk =
    state.openChunkIndex !== undefined ? view.nodes[state.openChunkIndex] : undefined
  if (openChunk !== undefined && hunksOf(openChunk).length > 0) {
    return (
      <>
        <HunkDeck
          chunk={openChunk}
          live={live === true}
          state={state}
          onDone={onDone === undefined ? undefined : runDone}
          busy={busy}
          undecided={undecided}
        />
        {noteSheet}
      </>
    )
  }

  return (
    <>
      <ChunkList
        nodes={view.nodes}
        state={state}
        scrollRef={scrollRef}
        onDone={onDone === undefined ? undefined : runDone}
        busy={busy}
        undecided={undecided}
      />
      {noteSheet}
    </>
  )
}

/** The terminal panel after `done` resolves. */
const HandedBackPanel = () => (
  <Notice data-testid="handed-back-panel" role="status" aria-live="polite">
    Handed back — this turn is done.
  </Notice>
)

export interface ReviewProps {
  readonly filePath: string
}

/** Every raw write `Review` wires up — mirrors `Plan.tsx#usePlanMutations`'s identical shape: a plain `trpc` call curried over its own anchor, no token/retry logic of its own. */
const useReviewMutations = (
  filePath: string,
  onFormatNotice: (notice: FormatNotice | undefined) => void,
) => {
  const utils = trpc.useUtils()
  const writeNote = trpc.writeNote.useMutation({
    onSettled: () => utils.readSteeringFile.invalidate({ filePath, mode: "review" }),
  })
  const setValue = trpc.setValue.useMutation({
    onSettled: () => utils.readSteeringFile.invalidate({ filePath, mode: "review" }),
  })
  const done = trpc.done.useMutation()

  const onSetValue =
    (anchor: SteeringAnchor, checked: boolean) =>
    (cas: CasTokens): Promise<unknown> =>
      setValue.mutateAsync({ filePath, ...cas, mode: "review", anchor, checked }).then((result) => {
        onFormatNotice(result.formatNotice)
        return result
      })

  const onCommitDecision =
    (anchor: SteeringAnchor, opts: { readonly checked?: boolean; readonly text?: string }) =>
    (cas: CasTokens): Promise<unknown> =>
      setValue.mutateAsync({ filePath, ...cas, mode: "review", anchor, ...opts }).then((result) => {
        onFormatNotice(result.formatNotice)
        return result
      })

  const onSaveNote =
    (anchor: SteeringAnchor, text: string) =>
    (cas: CasTokens): Promise<unknown> =>
      writeNote.mutateAsync({ filePath, ...cas, mode: "review", anchor, text }).then((result) => {
        onFormatNotice(result.formatNotice)
        return result
      })

  const onDoneNote =
    (anchor: SteeringAnchor, text: string) =>
    (cas: CasTokens): Promise<unknown> =>
      done.mutateAsync({ note: { filePath, ...cas, mode: "review", anchor, text } })

  const onDone = (): Promise<unknown> => done.mutateAsync({})

  return { onSaveNote, onDoneNote, onDone, onSetValue, onCommitDecision, isDone: done.isSuccess }
}

/** `Review`'s own inner render, a child of its `WriteStoreProvider`. */
const ReviewInner = ({
  filePath,
  data,
  isLoading,
  error,
}: ReviewProps & {
  readonly data: { readonly view?: SteeringView } | undefined
  readonly isLoading: boolean
  readonly error: unknown
}) => {
  const indicatorProps = useSaveIndicatorProps()
  const pending = useWriteStore((s) => s.pendingCount)
  const [formatNotice, setFormatNotice] = useState<FormatNotice | undefined>(undefined)
  const { onSaveNote, onDoneNote, onDone, onSetValue, onCommitDecision, isDone } =
    useReviewMutations(filePath, setFormatNotice)

  return (
    <>
      <SaveIndicator {...indicatorProps} />
      <FormatNoticeBanner notice={formatNotice} onDismiss={() => setFormatNotice(undefined)} />
      {isDone ? (
        <HandedBackPanel />
      ) : (
        <ReviewView
          view={data?.view}
          filePath={filePath}
          isLoading={isLoading}
          readError={error}
          live={true}
          onSaveNote={onSaveNote}
          onDoneNote={onDoneNote}
          onDone={onDone}
          onSetValue={onSetValue}
          onCommitDecision={onCommitDecision}
          busy={pending > 0}
        />
      )}
    </>
  )
}

/**
 * The real review screen: fetches the file's content/`view`/tokens through
 * `readSteeringFile` OUTSIDE the write store, handing `tokens`/
 * `refetchTokens` to `WriteStoreProvider` as props — see `Plan.tsx#Plan`'s
 * identical doc comment. `App.tsx` renders this when `trpc.step`'s own
 * `mode` is `"review"`.
 */
export const Review = ({ filePath }: ReviewProps) => {
  const utils = trpc.useUtils()
  const query = trpc.readSteeringFile.useQuery({ filePath, mode: "review" })

  const refetchTokens = async (): Promise<CasTokens> => {
    const fresh = await utils.readSteeringFile.fetch({ filePath, mode: "review" })
    return { expectedHeadSha: fresh.headSha, expectedContentHash: fresh.contentHash }
  }

  return (
    <WriteStoreProvider tokens={query.data} refetchTokens={refetchTokens}>
      <ReviewInner
        filePath={filePath}
        data={query.data}
        isLoading={query.isLoading}
        error={query.error}
      />
    </WriteStoreProvider>
  )
}
