import { useEffect, useRef, useState } from "react"
import type { SteeringAnchor, SteeringView, SteeringViewNode } from "../../steering/index.js"
import { Button } from "../Button.js"
import { Card, CardList } from "../Card.js"
import { useContentHashOverride } from "../contentHashOverride.js"
import { Deck } from "../Deck.js"
import { FormatNoticeBanner, type FormatNotice } from "../FormatNotice.js"
import { Notice } from "../Notice.js"
import { NoteSheet } from "../NoteSheet.js"
import { existingNoteFor, optimisticNoteSave } from "../notes.js"
import { messageForReadRefusal, RefusalBanner, useRefusal } from "../Refusal.js"
import { readRefusalFrom, trpc } from "../api.js"
import { withStaleShaRetry, type CasTokens } from "../staleRetry.js"
import { useScrollRestoration } from "../useScrollRestoration.js"
import { Inline } from "./InlineRun.js"
import { ProseBlocks } from "./ProseBlock.js"
import { defaultAnswerFor, Question, type QuestionAnswer } from "./Question.js"

const readPlanStorageKey = (contentHash: string): string => `gtd:plan-read:${contentHash}`

/** "Read the plan" confirmation, keyed on the SAME server-computed `contentHash` the compare-and-swap uses rather than a second client-only hash. A rewrite starts it unconfirmed again; `localStorage` survives a reload of the same file. */
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
 * The ONLY question nodes fed to `Deck`. An answered question carries no
 * options, so it must not be a deck ITEM at all, not merely a non-drillable
 * card: `deck-next`/`deck-prev` walk the item array directly and bypass any
 * per-card guard. The card's start index comes from this same list, so
 * advancing can never land past the last real question.
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
        <div className="text-small text-muted">
          <Inline inline={node.detailInline} fallback={node.detail} />
        </div>
      )}
    </>
  )
  const testId = `question-card-${node.anchor.kind === "question" ? node.anchor.index : 0}`
  if (onOpen === undefined) {
    return (
      // An answered question is finished, not disabled: it reads in the
      // muted text colour (which still clears AA) rather than at 85%
      // opacity, which dims a row's every layer including its own contrast.
      <div data-testid={testId} className="border-b border-divider p-3 text-muted">
        {content}
      </div>
    )
  }
  return (
    <Card testId={testId} onOpen={onOpen} accent>
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
   * Ends the turn with no note. Drives TWO controls: `Deck`'s `onDone`, whose
   * mere presence also flips the last-item advance label to "Back to list" —
   * two buttons reading "Done" on one screen is the collision that avoids —
   * and the list screen's own footer row.
   */
  readonly onDone?: () => Promise<unknown>
  /**
   * Every write refusal this screen's mutations surface, so `RefusalBanner`
   * names a reason instead of the write silently reverting. The optional
   * second argument is the whole failed write path, wired to the banner's
   * `Try again`; the question screen supplies none, since retyping already
   * serves as its retry.
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
      {/* The section that still needs the reader is coloured; the finished
          one stays muted — the list's own "what is left" cue, before a
          single card is read. */}
      <h2
        className={`mx-3 mt-4 mb-1 text-small font-semibold tracking-wide uppercase ${
          onOpen !== undefined ? "text-link" : "text-muted"
        }`}
      >
        {title}
      </h2>
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
  // `questionsView` (`OpenQuestions.ts`) builds `nodes` as every
  // `blockNodesOf` node in document order — before, between, and after the
  // question sections alike — followed by every question node. Filtering
  // the non-question nodes into one list here preserves their relative
  // document order; it is NOT "everything before `## Open Questions`".
  const planNodes = view.nodes.filter((node) => !isQuestionNode(node))
  const openNodes = questionNodes.filter((node) => node.status === "open")
  const answeredNodes = questionNodes.filter((node) => node.status === "answered")
  return (
    <>
      {/*
       * `allNodes={openNodes}`, NOT `questionNodes` — a card's start index
       * must be its position in the SAME list `PlanView` feeds `Deck`
       * (`openQuestionNodesOf`), or tapping a card would open the deck at
       * the wrong item the moment any answered question sorts before it.
       * Open questions render FIRST — they're the task; the prose below is
       * reference material — but this list, and the index it hands out,
       * stays untouched by that reordering.
       */}
      <QuestionSection
        title="Open Questions"
        nodes={openNodes}
        allNodes={openNodes}
        onOpen={onOpenQuestion}
      />
      {planNodes.length > 0 && (
        <ProseBlocks nodes={planNodes} noteOverrides={noteOverrides} onOpenNote={onOpenNote} />
      )}
      <QuestionSection title="Already answered" nodes={answeredNodes} allNodes={answeredNodes} />
    </>
  )
}

/** The "no view yet" branch's own message — loading, a named read refusal, or the generic fallback — split out so `PlanView` itself doesn't carry the nested ternary inline. */
const planLoadingMessage = (isLoading: boolean, readError: unknown): string => {
  if (isLoading) return "Loading the plan…"
  const refusal = readError !== undefined ? readRefusalFrom(readError) : undefined
  return refusal !== undefined ? messageForReadRefusal(refusal) : "Could not load the plan."
}

/**
 * `Deck`'s own `onDone`/`doneLabel` prop pair (package 04 Task 2) — `{}`
 * when the Q&A deck's Done control isn't wired up at all (`Plan.stories.tsx`'s
 * pure-data stories, exactly like `onSaveNote`/`onDoneNote`), split out so
 * `PlanView` itself doesn't carry this conditional inline.
 */
const deckDoneProps = (
  onDone: (() => Promise<unknown>) | undefined,
): { readonly onDone?: () => void; readonly doneLabel?: string } =>
  onDone === undefined
    ? {}
    : {
        onDone: () => {
          onDone()
        },
        doneLabel: "Done",
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
  onDone,
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
    return (
      <Notice tone={isLoading ? "info" : "error"}>
        {planLoadingMessage(isLoading, readError)}
      </Notice>
    )
  }

  // Rendered OVER the screen it belongs to (a modal), never instead of it —
  // so it is built here and mounted by each branch below rather than
  // returned early.
  const existingNote =
    noteSheetAnchor === undefined
      ? undefined
      : existingNoteFor(view.nodes, noteSheetAnchor, noteOverrides)
  const noteSheet =
    noteSheetAnchor === undefined ? null : (
      <NoteSheet
        anchor={noteSheetAnchor}
        {...(existingNote !== undefined ? { note: existingNote } : {})}
        onSave={optimisticNoteSave({
          setOverrides: setNoteOverrides,
          close: () => setNoteSheetAnchor(undefined),
          ...(onSaveNote !== undefined ? { write: onSaveNote } : {}),
          ...(onRefusal !== undefined ? { onRefusal } : {}),
        })}
        onDismiss={() => setNoteSheetAnchor(undefined)}
        {...(onDoneNote !== undefined
          ? {
              onDone: optimisticNoteSave({
                setOverrides: setNoteOverrides,
                close: () => setNoteSheetAnchor(undefined),
                write: onDoneNote,
              }),
            }
          : {})}
      />
    )

  if (deckIndex !== undefined) {
    return (
      <>
        <Deck
          items={openQuestionNodesOf(view)}
          index={deckIndex}
          onIndexChange={setDeckIndex}
          onExit={() => {
            setDeckIndex(undefined)
            scroll.restore(scrollRef)
          }}
          {...deckDoneProps(onDone)}
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
              noteOverrides={noteOverrides}
              onOpenNote={(bodyNode) => setNoteSheetAnchor(bodyNode.anchor)}
            />
          )}
        />
        {noteSheet}
      </>
    )
  }

  return (
    <>
      <div data-testid="plan-screen" className="flex h-full min-h-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          <CardList>
            {/* The confirmation is a state, so it gets a persistent mark, not
              a tick appended to the label: the row reads the same before and
              after otherwise. */}
            <Card testId="read-plan-row" onOpen={confirm}>
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`grid size-5 shrink-0 place-items-center rounded-full border text-small ${
                    confirmed ? "border-accent text-accent" : "border-border"
                  }`}
                >
                  {confirmed ? "✓" : ""}
                </span>
                <span className={confirmed ? "text-muted" : undefined}>Read the plan</span>
              </span>
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
        {onDone !== undefined && (
          <div
            data-testid="plan-done-row"
            className="flex shrink-0 items-center justify-end border-t border-border p-3"
          >
            <Button
              variant="primary"
              data-testid="plan-done"
              onClick={() => {
                onDone()
              }}
            >
              Done
            </Button>
          </div>
        )}
      </div>
      {noteSheet}
    </>
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

/**
 * Every mutation `Plan` wires up, in one hook so the component stays a thin
 * fetch-then-render dispatch. Each write routes through `withStaleShaRetry`: a
 * `stale-token`/`moved: "sha"` refusal refetches and retries once, silently,
 * before the banner shows. The token comes from `contentHashOverride` — see
 * its doc for why a second Save before the refetch lands must send the LAST
 * write's post-format hash, never the cache's stale one.
 */
const usePlanMutations = (
  filePath: string,
  mode: string,
  data: { readonly headSha: string; readonly contentHash: string } | undefined,
  onRefusal: (error: unknown) => void,
  /** Task 5's own `ui.format`-failure sink — `ui.format` runs on every ui write regardless of screen, so `Plan`'s own writes surface it exactly like `FreeForm.tsx`'s do. */
  onFormatNotice: (notice: FormatNotice | undefined) => void,
) => {
  const override = useContentHashOverride()
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
    override.clear()
    return { expectedHeadSha: fresh.headSha, expectedContentHash: fresh.contentHash }
  }

  const onCommitAnswer = (
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ): Promise<unknown> => {
    const tokens = override.casTokensFor(data)
    if (tokens === undefined) return Promise.reject(new Error("no steering file loaded yet"))
    return withStaleShaRetry(
      (cas) =>
        setValue.mutateAsync({ filePath, ...cas, mode, anchor, ...opts }).then((result) => {
          override.onWriteSuccess(result.contentHash)
          onFormatNotice(result.formatNotice)
          return result
        }),
      tokens,
      refetchTokens,
    ).catch((error: unknown) => {
      override.onWriteRefusal(error)
      throw error
    })
  }

  const onSaveNote = (anchor: SteeringAnchor, text: string): Promise<unknown> => {
    const tokens = override.casTokensFor(data)
    if (tokens === undefined) return Promise.reject(new Error("no steering file loaded yet"))
    return withStaleShaRetry(
      (cas) =>
        writeNote.mutateAsync({ filePath, ...cas, mode, anchor, text }).then((result) => {
          override.onWriteSuccess(result.contentHash)
          onFormatNotice(result.formatNotice)
          return result
        }),
      tokens,
      refetchTokens,
    ).catch((error: unknown) => {
      override.onWriteRefusal(error)
      throw error
    })
  }

  const onDoneNote = (anchor: SteeringAnchor, text: string): Promise<unknown> => {
    const tokens = override.casTokensFor(data)
    if (tokens === undefined) return Promise.reject(new Error("no steering file loaded yet"))
    return withStaleShaRetry(
      (cas) =>
        done.mutateAsync({ note: { filePath, ...cas, mode, anchor, text } }).then((result) => {
          if ("contentHash" in result) override.onWriteSuccess(result.contentHash)
          return result
        }),
      tokens,
      refetchTokens,
    ).catch((error: unknown) => {
      override.onWriteRefusal(error)
      // Shows the reason but never rethrows: `NoteSheet`'s own `onDone` is
      // fire-and-forget (never awaited), so an uncaught rejection this far
      // down would be a real unhandled promise rejection, not just a
      // silently-discarded one.
      onRefusal(error)
    })
  }

  /**
   * The Done control's own trigger (T2) — no anchor/text, no tokens: there
   * is nothing to compare-and-swap when there's nothing to write, mirroring
   * `Router.ts#done`'s own `note` absent branch. Fire-and-forget, caught
   * never rethrown, for the exact reason `onDoneNote`'s own `.catch` is.
   */
  const onDone = (): Promise<unknown> =>
    done.mutateAsync({}).catch((error: unknown) => {
      onRefusal(error)
    })

  return { onCommitAnswer, onSaveNote, onDoneNote, onDone, isDone: done.isSuccess }
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
  const [formatNotice, setFormatNotice] = useState<FormatNotice | undefined>(undefined)
  const { onCommitAnswer, onSaveNote, onDoneNote, onDone, isDone } = usePlanMutations(
    filePath,
    mode,
    query.data,
    showRefusal,
    setFormatNotice,
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
      <FormatNoticeBanner notice={formatNotice} onDismiss={() => setFormatNotice(undefined)} />
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
          onDone={onDone}
          onCommitAnswer={onCommitAnswerTracked}
          onRefusal={showRefusal}
        />
      )}
    </>
  )
}
