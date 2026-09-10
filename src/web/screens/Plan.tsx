import { useEffect, useRef, useState } from "react"
import type { SteeringAnchor, SteeringView, SteeringViewNode } from "../../SteeringFormat.js"
import { Card, CardList } from "../Card.js"
import { Deck } from "../Deck.js"
import { Notice } from "../Notice.js"
import { NoteSheet } from "../NoteSheet.js"
import { messageForReadRefusal, RefusalBanner, useRefusal } from "../Refusal.js"
import { readRefusalFrom, trpc } from "../api.js"
import { withStaleShaRetry, type CasTokens } from "../staleRetry.js"
import { useScrollRestoration } from "../useScrollRestoration.js"
import { ProseBlocks } from "./ProseBlock.js"
import { defaultAnswerFor, Question, type QuestionAnswer } from "./Question.js"

const readPlanStorageKey = (contentHash: string): string => `gtd:plan-read:${contentHash}`

/**
 * "Read the plan" confirmation state, keyed on the file's own `contentHash`
 * — the SAME token `readSteeringFile`/`writeNote` already compute
 * server-side (`Write.ts#contentHashOf`) and the real `Plan` container
 * already threads through for its `writeNote` compare-and-swap. Hand-rolling
 * a second, client-only hash of the same bytes here would be two hashes of
 * one file for no reason; a rewrite (a different `contentHash`) always
 * starts this confirmation unconfirmed again — persisted in `localStorage`
 * so it survives a reload of the same, unchanged file.
 */
const usePlanReadConfirmation = (contentHash: string) => {
  const [confirmed, setConfirmed] = useState(
    () => localStorage.getItem(readPlanStorageKey(contentHash)) === "true",
  )

  useEffect(() => {
    setConfirmed(localStorage.getItem(readPlanStorageKey(contentHash)) === "true")
  }, [contentHash])

  const confirm = () => {
    localStorage.setItem(readPlanStorageKey(contentHash), "true")
    setConfirmed(true)
  }

  return { confirmed, confirm }
}

/** A `qa`-view question node sets `status` (`"open"`/`"answered"`); a prose-only document's `view` has no such nodes at all — every one of its `view.nodes` is instead a `paragraph`-anchored node (`OpenQuestions.ts#blockNodesOf`). */
const isQuestionNode = (node: SteeringViewNode): boolean => node.status !== undefined

/**
 * The ONLY question nodes ever fed to `Deck` (and the ONLY ones the "Open
 * Questions" card section indexes into) — an answered question's own `view`
 * node carries no options at all (`OpenQuestions.ts`'s answered section never
 * has checkboxes), so it must never be a deck ITEM either, not just a
 * non-drillable card: `deck-next`/`deck-prev` navigate the deck's own item
 * array directly, bypassing any per-card `onOpen` guard entirely. Both the
 * card's start index and the deck's item list come from this SAME list, so
 * advancing within the deck can never land past its last real question.
 */
const openQuestionNodesOf = (view: SteeringView): readonly SteeringViewNode[] =>
  view.nodes.filter((node) => node.status === "open")

/**
 * `onOpen` is OPTIONAL: an ANSWERED question's own `view` node carries no
 * options at all (`OpenQuestions.ts#OpenQuestion.options` is `[]` for the
 * answered section — there is nothing left to review or edit), so drilling
 * into `Question.tsx` for one renders zero options, an empty `lastIndex`,
 * and — worse — recomputes "unanswered" from that empty state, contradicting
 * the very section the card came from. An answered card renders as an
 * inert, non-button summary row instead of a fake-clickable `Card`.
 */
// fallow-ignore-next-line complexity
const QuestionCard = ({
  node,
  onOpen,
}: {
  readonly node: SteeringViewNode
  readonly onOpen?: () => void
}) => {
  const content = (
    <>
      <div className="font-semibold">{node.title}</div>
      {node.detail !== undefined && node.detail.length > 0 && (
        <div className="text-small text-muted">{node.detail}</div>
      )}
    </>
  )
  const testId = `question-card-${node.anchor.kind === "question" ? node.anchor.index : 0}`
  if (onOpen === undefined) {
    return (
      <div data-testid={testId} className="border-b border-border p-3 opacity-[0.85]">
        {content}
      </div>
    )
  }
  return (
    <Card testId={testId} onOpen={onOpen}>
      {content}
    </Card>
  )
}

export interface PlanViewProps {
  readonly view: SteeringView | undefined
  /** The file's `contentHash` (`Write.ts#contentHashOf`, already computed server-side by `readSteeringFile`) — used ONLY to key the "read the plan" confirmation below. Never the raw file bytes: there is nothing else in this component that needs them since paragraph text comes from `view.nodes` (`OpenQuestions.ts#blockNodesOf`), not a client-side split of raw content. */
  readonly contentHash: string
  readonly isLoading: boolean
  /** The `readSteeringFile` query's own thrown error, read through `api.ts#readRefusalFrom` to render a named sentence when `view` is `undefined` and nothing is loading — `Plan.stories.tsx`'s pure-data stories leave this unset and see the generic fallback. */
  readonly readError?: unknown
  /**
   * Called with a saved paragraph note's `anchor`/`text` — the real `Plan`
   * container wires this to an actual `writeNote` mutation, returning
   * `writeNote.mutateAsync`'s OWN promise so a rejection (a `CONFLICT`
   * refusal, a network failure, …) reverts the optimistic `noteOverrides`
   * entry — see `Review.tsx#ReviewViewProps.onSaveNote`'s identical doc
   * comment for why. Absent in `Plan.stories.tsx`'s pure-data stories.
   */
  readonly onSaveNote?: (anchor: SteeringAnchor, text: string) => Promise<unknown>
  /**
   * The done action (T2): saves the SAME note `onSaveNote` would, then hands
   * the turn back — the real `Plan` container wires this to `trpc.done`,
   * which writes the note and calls `ctx.handOff()` server-side, ending
   * this `gtd ui` process. Absent in `Plan.stories.tsx`'s pure-data stories,
   * exactly like `onSaveNote`.
   */
  readonly onDoneNote?: (anchor: SteeringAnchor, text: string) => Promise<unknown>
  /**
   * Write-through for a question answer (package 03): passed straight to
   * `Question.tsx`'s own `onCommitAnswer` prop — see that prop's doc comment
   * for why it fires alongside, never instead of, this component's own
   * `answers` state. Absent in `Plan.stories.tsx`'s pure-data stories,
   * exactly like `onSaveNote`/`onDoneNote`.
   */
  readonly onCommitAnswer?: (
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ) => Promise<unknown>
  /**
   * Every write refusal this screen's mutations surface (package 03 Task 1)
   * — passed straight to `Question.tsx`'s own `onRefusal`, and to
   * `onSaveNote`/`onDoneNote`'s own `.catch`, so the same `RefusalBanner` the
   * real `Plan` container mounts above this view shows a named reason
   * instead of the write silently reverting. The optional second argument
   * (task 01) is the whole write path that just failed, wired through to
   * `RefusalBanner`'s own `Try again` control — `onSaveNote`'s own `.catch`
   * below is the only call site here that supplies one; `Question.tsx`'s own
   * `onRefusal` call (for `onCommitAnswer`) is unchanged and supplies none,
   * since that screen already has its own retry-by-retyping affordance
   * (package 03). Absent in `Plan.stories.tsx`'s pure-data stories.
   */
  readonly onRefusal?: (error: unknown, retry?: () => Promise<unknown>) => void
}

/** `onOpen` absent renders every card in this section as an inert summary row — used for "Already answered", whose questions carry no options to drill into (see `QuestionCard`'s own doc comment). */
const QuestionSection = ({
  title,
  nodes,
  allNodes,
  onOpen,
}: {
  readonly title: string
  readonly nodes: readonly SteeringViewNode[]
  readonly allNodes: readonly SteeringViewNode[]
  readonly onOpen?: (index: number) => void
}) => {
  if (nodes.length === 0) return null
  return (
    <section>
      <h2 className="m-3 text-small text-muted">{title}</h2>
      {nodes.map((node) => (
        <QuestionCard
          key={allNodes.indexOf(node)}
          node={node}
          {...(onOpen !== undefined ? { onOpen: () => onOpen(allNodes.indexOf(node)) } : {})}
        />
      ))}
    </section>
  )
}

/** The question-list body: prose paragraphs for a format with no question-shaped nodes, else the open/answered sections. */
const PlanBody = ({
  view,
  noteOverrides,
  onOpenQuestion,
  onOpenNote,
}: {
  readonly view: SteeringView
  readonly noteOverrides: Readonly<Record<number, string>>
  readonly onOpenQuestion: (index: number) => void
  readonly onOpenNote: (node: SteeringViewNode) => void
}) => {
  const questionNodes = view.nodes.filter(isQuestionNode)
  if (questionNodes.length === 0) {
    return <ProseBlocks nodes={view.nodes} noteOverrides={noteOverrides} onOpenNote={onOpenNote} />
  }
  // `OpenQuestions.ts#questionsView` prepends the plan's own lead prose
  // (everything before `## Open Questions`) as plain paragraph nodes ahead
  // of the question nodes — render it here too, or the "Read the plan" row
  // above confirms a plan that's nowhere on screen (requirement 4/T5).
  const planNodes = view.nodes.filter((node) => !isQuestionNode(node))
  const openNodes = questionNodes.filter((node) => node.status === "open")
  const answeredNodes = questionNodes.filter((node) => node.status === "answered")
  return (
    <>
      {planNodes.length > 0 && (
        <ProseBlocks nodes={planNodes} noteOverrides={noteOverrides} onOpenNote={onOpenNote} />
      )}
      {/*
       * `allNodes={openNodes}`, NOT `questionNodes` — a card's start index
       * must be its position in the SAME list `PlanView` feeds `Deck`
       * (`openQuestionNodesOf`), or tapping a card would open the deck at
       * the wrong item the moment any answered question sorts before it.
       */}
      <QuestionSection
        title="Open Questions"
        nodes={openNodes}
        allNodes={openNodes}
        onOpen={onOpenQuestion}
      />
      <QuestionSection title="Already answered" nodes={answeredNodes} allNodes={answeredNodes} />
    </>
  )
}

/**
 * Presentational plan-and-answer screen — takes its `view`/`contentHash` as
 * props so `Plan.stories.tsx` can drive every shape with plain data, no
 * mocked tRPC transport required. Never switches on a mode name: whether
 * this renders questions or plain prose is read entirely off `view.nodes`'
 * own shape.
 */
// fallow-ignore-next-line complexity
export const PlanView = ({
  view,
  contentHash,
  isLoading,
  readError,
  onSaveNote,
  onDoneNote,
  onCommitAnswer,
  onRefusal,
}: PlanViewProps) => {
  const { confirmed, confirm } = usePlanReadConfirmation(contentHash)
  const [deckIndex, setDeckIndex] = useState<number | undefined>(undefined)
  const [noteOverrides, setNoteOverrides] = useState<Record<number, string>>({})
  const [noteSheetAnchor, setNoteSheetAnchor] = useState<SteeringAnchor | undefined>(undefined)
  // Keyed by the SAME index `openQuestionNodesOf` assigns (the deck's own
  // item index) — lives here, above `Deck`, so an answer survives paging
  // next-then-back: `Deck`'s `renderItem` remounts a fresh `Question` per
  // index, which would otherwise discard whatever was just answered.
  const [answers, setAnswers] = useState<Record<number, QuestionAnswer>>({})
  const scroll = useScrollRestoration()
  const scrollRef = useRef<HTMLDivElement | null>(null)

  if (view === undefined) {
    const refusal = readError !== undefined ? readRefusalFrom(readError) : undefined
    return (
      <Notice tone={isLoading ? "info" : "error"}>
        {isLoading
          ? "Loading the plan…"
          : refusal !== undefined
            ? messageForReadRefusal(refusal)
            : "Could not load the plan."}
      </Notice>
    )
  }

  if (noteSheetAnchor !== undefined) {
    const line = noteSheetAnchor.kind === "paragraph" ? noteSheetAnchor.line : undefined
    const originalNote = view.nodes.find(
      (node) => node.anchor.kind === "paragraph" && node.anchor.line === line,
    )?.note
    const existing = (line !== undefined ? noteOverrides[line] : undefined) ?? originalNote
    return (
      <NoteSheet
        anchor={noteSheetAnchor}
        {...(existing !== undefined ? { note: existing } : {})}
        onSave={(anchor, text) => {
          if (anchor.kind === "paragraph") {
            setNoteOverrides((prev) => ({ ...prev, [anchor.line]: text }))
          }
          setNoteSheetAnchor(undefined)
          // A refused/failed write reverts the optimistic override — see
          // `Review.tsx#useReviewState`'s `saveNote`'s identical comment.
          onSaveNote?.(anchor, text)?.catch((error: unknown) => {
            // `onSaveNote` is surely defined here — this `.catch` only runs
            // off a promise `onSaveNote?.(...)` itself returned.
            onRefusal?.(error, () => onSaveNote(anchor, text))
            if (anchor.kind === "paragraph") {
              setNoteOverrides((prev) => {
                const next = { ...prev }
                delete next[anchor.line]
                return next
              })
            }
          })
        }}
        onDismiss={() => setNoteSheetAnchor(undefined)}
        {...(onDoneNote !== undefined
          ? {
              onDone: (anchor: SteeringAnchor, text: string) => {
                if (anchor.kind === "paragraph") {
                  setNoteOverrides((prev) => ({ ...prev, [anchor.line]: text }))
                }
                setNoteSheetAnchor(undefined)
                onDoneNote(anchor, text)
              },
            }
          : {})}
      />
    )
  }

  if (deckIndex !== undefined) {
    return (
      <Deck
        items={openQuestionNodesOf(view)}
        index={deckIndex}
        onIndexChange={setDeckIndex}
        onExit={() => {
          setDeckIndex(undefined)
          scroll.restore(scrollRef)
        }}
        renderItem={(node, index) => (
          <Question
            key={index}
            node={node}
            answer={answers[index] ?? defaultAnswerFor(node)}
            onAnswerChange={(update) =>
              setAnswers((prev) => {
                const current = prev[index] ?? defaultAnswerFor(node)
                const next = typeof update === "function" ? update(current) : update
                return { ...prev, [index]: next }
              })
            }
            {...(onCommitAnswer !== undefined ? { onCommitAnswer } : {})}
            {...(onRefusal !== undefined ? { onRefusal } : {})}
          />
        )}
      />
    )
  }

  return (
    <div data-testid="plan-screen" className="flex h-full min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <CardList>
          <Card testId="read-plan-row" onOpen={confirm}>
            Read the plan{confirmed ? " ✓" : ""}
          </Card>
          <PlanBody
            view={view}
            noteOverrides={noteOverrides}
            onOpenQuestion={(index) => {
              scroll.capture(scrollRef)
              setDeckIndex(index)
            }}
            onOpenNote={(node) => setNoteSheetAnchor(node.anchor)}
          />
        </CardList>
      </div>
    </div>
  )
}

/**
 * The terminal panel after `done` resolves (T2): the server has already
 * written the note and called `ctx.handOff()`, so the process exits moments
 * later — this needs no further server round trip, and offers no way back to
 * any list. Identical in shape to `Review.tsx#HandedBackPanel` — see that
 * component's own doc comment for why this stays a second small copy rather
 * than a shared import.
 */
const HandedBackPanel = () => (
  <Notice data-testid="handed-back-panel" role="status" aria-live="polite">
    Handed back — this turn is done.
  </Notice>
)

export interface PlanProps {
  /** Path to the plan/prose steering file, relative to the served worktree. */
  readonly filePath: string
  readonly mode: string
}

/** The compare-and-swap token pair every one of `Plan`'s mutation wrappers sends, off the live `readSteeringFile` read — `undefined` when the read hasn't resolved yet, mirroring `Review.tsx`'s identical "no steering file loaded yet" guard. */
const casTokensFor = (
  data: { readonly headSha: string; readonly contentHash: string } | undefined,
): CasTokens | undefined =>
  data === undefined
    ? undefined
    : { expectedHeadSha: data.headSha, expectedContentHash: data.contentHash }

/**
 * Every mutation `Plan` wires up, pulled into one hook so the component
 * itself stays a thin fetch-then-render dispatch (see `useReviewState` in
 * `Review.tsx` for the same split, applied to that screen's own local state
 * instead of its mutations). Every write routes through
 * `staleRetry.ts#withStaleShaRetry` (task 01): a `stale-token`/`moved: "sha"`
 * refusal refetches fresh tokens and retries once, silently, before the
 * banner ever shows.
 */
const usePlanMutations = (
  filePath: string,
  mode: string,
  data: { readonly headSha: string; readonly contentHash: string } | undefined,
  onRefusal: (error: unknown) => void,
) => {
  const utils = trpc.useUtils()
  const writeNote = trpc.writeNote.useMutation({
    onSettled: () => utils.readSteeringFile.invalidate({ filePath, mode }),
  })
  const setValue = trpc.setValue.useMutation({
    onSettled: () => utils.readSteeringFile.invalidate({ filePath, mode }),
  })
  const done = trpc.done.useMutation()

  // `fetch`, never `invalidate` — the retry needs the fresh tokens back as a
  // value to call `attempt` with a second time; `onSettled`'s own
  // `invalidate` above stays and populates the SAME cache entry, so the two
  // don't fight (see the package's own task 4 doc comment).
  const refetchTokens = async (): Promise<CasTokens> => {
    const fresh = await utils.readSteeringFile.fetch({ filePath, mode })
    return { expectedHeadSha: fresh.headSha, expectedContentHash: fresh.contentHash }
  }

  const onCommitAnswer = (
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ): Promise<unknown> => {
    const tokens = casTokensFor(data)
    if (tokens === undefined) return Promise.reject(new Error("no steering file loaded yet"))
    return withStaleShaRetry(
      (cas) => setValue.mutateAsync({ filePath, ...cas, mode, anchor, ...opts }),
      tokens,
      refetchTokens,
    )
  }

  const onSaveNote = (anchor: SteeringAnchor, text: string): Promise<unknown> => {
    const tokens = casTokensFor(data)
    if (tokens === undefined) return Promise.reject(new Error("no steering file loaded yet"))
    return withStaleShaRetry(
      (cas) => writeNote.mutateAsync({ filePath, ...cas, mode, anchor, text }),
      tokens,
      refetchTokens,
    )
  }

  const onDoneNote = (anchor: SteeringAnchor, text: string): Promise<unknown> => {
    const tokens = casTokensFor(data)
    if (tokens === undefined) return Promise.reject(new Error("no steering file loaded yet"))
    return withStaleShaRetry(
      (cas) => done.mutateAsync({ filePath, ...cas, mode, anchor, text }),
      tokens,
      refetchTokens,
    ).catch((error: unknown) => {
      // Shows the reason but never rethrows: `NoteSheet`'s own `onDone` is
      // fire-and-forget (never awaited), so an uncaught rejection this far
      // down would be a real unhandled promise rejection, not just a
      // silently-discarded one.
      onRefusal(error)
    })
  }

  return { onCommitAnswer, onSaveNote, onDoneNote, isDone: done.isSuccess }
}

/** `PlanView`'s own two data props, both `undefined`-safe over an in-flight `readSteeringFile` read — split out so `Plan` itself doesn't carry the two optional-chaining branches inline. */
const planViewDataProps = (
  data: { readonly view?: SteeringView; readonly contentHash?: string } | undefined,
) => ({ view: data?.view, contentHash: data?.contentHash ?? "" })

/**
 * The real plan screen: fetches content/`view`/tokens through
 * `readSteeringFile` (never a bare `content` prop with no way to have
 * actually been fetched — see `Review.tsx#Review`'s identical split), and
 * write-throughs a saved paragraph note via `writeNote`'s compare-and-swap
 * using the SAME tokens that fetch returned. `App.tsx` renders this when
 * `trpc.step`'s own `mode` isn't `"review"`.
 */
export const Plan = ({ filePath, mode }: PlanProps) => {
  const query = trpc.readSteeringFile.useQuery({ filePath, mode })
  const { refusal, saveStatus, showRefusal, dismiss, trackSave, onRetry } = useRefusal()
  const { onCommitAnswer, onSaveNote, onDoneNote, isDone } = usePlanMutations(
    filePath,
    mode,
    query.data,
    showRefusal,
  )

  // Task 3's "Saving…"/"Saved" affordance — wraps only the two write paths a
  // human sits waiting on mid-interaction (a tick, a note save); `onDoneNote`
  // is excluded since a successful `done` unmounts this screen for
  // `HandedBackPanel` before the banner could ever show "Saved".
  const onCommitAnswerTracked = (
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ): Promise<unknown> => trackSave(onCommitAnswer(anchor, opts))
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
      {isDone ? (
        // Once `done` resolves, the server has already written the note and
        // called `ctx.handOff()` — see `Review.tsx#Review`'s identical check
        // for why nothing past this point renders `PlanView` again.
        <HandedBackPanel />
      ) : (
        <PlanView
          {...planViewDataProps(query.data)}
          isLoading={query.isLoading}
          readError={query.error}
          onSaveNote={onSaveNoteTracked}
          onDoneNote={onDoneNote}
          onCommitAnswer={onCommitAnswerTracked}
          onRefusal={showRefusal}
        />
      )}
    </>
  )
}
