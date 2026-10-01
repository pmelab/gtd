import { useEffect, useRef, useState } from "react"
import type { SteeringAnchor, SteeringView, SteeringViewNode } from "../../steering/index.js"
import { Button } from "../Button.js"
import { Card, CardList } from "../Card.js"
import { Deck } from "../Deck.js"
import { FormatNoticeBanner, type FormatNotice } from "../FormatNotice.js"
import { Notice } from "../Notice.js"
import { NoteSheet } from "../NoteSheet.js"
import { existingNoteFor } from "../notes.js"
import { messageForReadRefusal, SaveIndicator, useSaveIndicatorProps } from "../Refusal.js"
import { readRefusalFrom, trpc } from "../api.js"
import type { CasTokens } from "../staleRetry.js"
import { useScrollRestoration } from "../useScrollRestoration.js"
import {
  cellKey,
  latestOverlayValue,
  useWriteStore,
  WriteStoreProvider,
  type OverlayEntry,
} from "../writeStore.js"
import { Inline } from "./InlineRun.js"
import { ProseBlocks } from "./ProseBlock.js"
import { Question } from "./Question.js"

/** A write guarded by the store's own compare-and-swap retry — see `writeStore.ts#SaveArgs.write`'s own doc comment. */
type TokenGuardedWrite = (tokens: CasTokens) => Promise<unknown>

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

/** A `qa`-view question node sets `status` (`"open"`/`"answered"`); a prose-only document's `view` has no such nodes at all. */
const isQuestionNode = (node: SteeringViewNode): boolean => node.status !== undefined

const openQuestionNodesOf = (view: SteeringView): readonly SteeringViewNode[] =>
  view.nodes.filter((node) => node.status === "open")

/** Every paragraph-anchored node's own overlay text, read straight off the store — the `noteOverrides` record `ProseBlocks`/`existingNoteFor` expect, built fresh each render rather than kept as a second copy of state. Reads BOTH a plain save's own `"note"` cell and that same anchor's `"done"` cell (a Save & Done), since only one of the two is ever written per interaction and whichever is newer should show. */
// fallow-ignore-next-line complexity
const noteOverridesFrom = (
  filePath: string,
  overlay: Readonly<Record<string, OverlayEntry>>,
  nodes: readonly SteeringViewNode[],
): Record<number, string> => {
  const overrides: Record<number, string> = {}
  for (const node of nodes.flatMap((n) => [n, ...(n.body ?? [])])) {
    if (node.anchor.kind !== "paragraph") continue
    const value = latestOverlayValue(overlay, [
      cellKey(filePath, node.anchor, "note"),
      cellKey(filePath, node.anchor, "done"),
    ])
    if (typeof value === "string") overrides[node.anchor.line] = value
  }
  return overrides
}

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
  readonly filePath: string
  readonly contentHash: string
  readonly isLoading: boolean
  readonly readError?: unknown
  readonly onSaveNote?: (anchor: SteeringAnchor, text: string) => TokenGuardedWrite
  readonly onDoneNote?: (anchor: SteeringAnchor, text: string) => TokenGuardedWrite
  readonly onCommitAnswer?: (
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ) => TokenGuardedWrite
  readonly onDone?: () => Promise<unknown>
  /** Package 03 Task 1's single `busy` boolean, threaded from the store's own pending count. */
  readonly busy?: boolean | undefined
}

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
  const planNodes = view.nodes.filter((node) => !isQuestionNode(node))
  const openNodes = questionNodes.filter((node) => node.status === "open")
  const answeredNodes = questionNodes.filter((node) => node.status === "answered")
  return (
    <>
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

const planLoadingMessage = (isLoading: boolean, readError: unknown): string => {
  if (isLoading) return "Loading the plan…"
  const refusal = readError !== undefined ? readRefusalFrom(readError) : undefined
  return refusal !== undefined ? messageForReadRefusal(refusal) : "Could not load the plan."
}

const deckDoneProps = (
  onDone: (() => void) | undefined,
  busy: boolean | undefined,
): {
  readonly onDone?: () => void
  readonly doneLabel?: string
  readonly doneDisabled?: boolean | undefined
} => (onDone === undefined ? {} : { onDone, doneLabel: "Done", doneDisabled: busy })

/**
 * Presentational plan-and-answer screen — takes its `view`/`contentHash` as
 * props so `Plan.stories.tsx` can drive every shape with plain data; the
 * global storybook decorator supplies a fresh `WriteStoreProvider`, which is
 * the only thing this component needs to resolve its own note overrides and
 * each `Question`'s own answer.
 */
// fallow-ignore-next-line complexity
export const PlanView = ({
  view,
  filePath,
  contentHash,
  isLoading,
  readError,
  onSaveNote,
  onDoneNote,
  onDone,
  onCommitAnswer,
  busy,
}: PlanViewProps) => {
  const { confirmed, confirm } = usePlanReadConfirmation(contentHash)
  const [deckIndex, setDeckIndex] = useState<number | undefined>(undefined)
  const [noteSheetAnchor, setNoteSheetAnchor] = useState<SteeringAnchor | undefined>(undefined)
  const overlay = useWriteStore((s) => s.overlay)
  const save = useWriteStore((s) => s.save)
  const scroll = useScrollRestoration()
  const scrollRef = useRef<HTMLDivElement | null>(null)

  if (view === undefined) {
    return (
      <Notice tone={isLoading ? "info" : "error"}>
        {planLoadingMessage(isLoading, readError)}
      </Notice>
    )
  }

  const noteOverrides = noteOverridesFrom(filePath, overlay, view.nodes)

  const saveNote = (anchor: SteeringAnchor, text: string): void => {
    save({
      cell: cellKey(filePath, anchor, "note"),
      optimistic: text,
      write: onSaveNote === undefined ? undefined : onSaveNote(anchor, text),
    }).catch(() => {})
  }
  const doneNote = (anchor: SteeringAnchor, text: string): void => {
    save({
      cell: cellKey(filePath, anchor, "done"),
      optimistic: text,
      write: onDoneNote === undefined ? undefined : onDoneNote(anchor, text),
    }).catch(() => {})
  }

  const existingNote =
    noteSheetAnchor === undefined
      ? undefined
      : existingNoteFor(view.nodes, noteSheetAnchor, noteOverrides)
  const noteSheet =
    noteSheetAnchor === undefined ? null : (
      <NoteSheet
        anchor={noteSheetAnchor}
        {...(existingNote !== undefined ? { note: existingNote } : {})}
        onSave={(anchor, text) => {
          setNoteSheetAnchor(undefined)
          saveNote(anchor, text)
        }}
        onDismiss={() => setNoteSheetAnchor(undefined)}
        {...(onDoneNote !== undefined
          ? {
              onDone: (anchor: SteeringAnchor, text: string) => {
                setNoteSheetAnchor(undefined)
                doneNote(anchor, text)
              },
              busy,
            }
          : {})}
      />
    )

  const runDone = (): void => {
    if (onDone === undefined) return
    save({ cell: cellKey(filePath, undefined, "done"), optimistic: true, mutate: onDone }).catch(
      () => {},
    )
  }

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
          {...deckDoneProps(onDone === undefined ? undefined : runDone, busy)}
          renderItem={(node, index) => (
            <Question
              key={index}
              node={node}
              filePath={filePath}
              {...(onCommitAnswer !== undefined ? { onCommitAnswer } : {})}
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
            <Button variant="primary" data-testid="plan-done" onClick={runDone} disabled={busy}>
              Done
            </Button>
          </div>
        )}
      </div>
      {noteSheet}
    </>
  )
}

/** The terminal panel after `done` resolves: the server has already written the note and called `ctx.handOff()`, so the process exits moments later. */
const HandedBackPanel = () => (
  <Notice data-testid="handed-back-panel" role="status" aria-live="polite">
    Handed back — this turn is done.
  </Notice>
)

export interface PlanProps {
  readonly filePath: string
  readonly mode: string
}

/**
 * Every raw write `Plan` wires up — each is a plain `trpc` call, curried over
 * its own anchor/opts, returning a `TokenGuardedWrite`: the store itself
 * supplies the compare-and-swap tokens (and retries a `stale-token` refusal)
 * when it calls this thunk at dequeue time. No `withStaleShaRetry`, no
 * token/override bookkeeping lives here any more — `WriteStoreProvider`'s own
 * `tokens`/`refetchTokens` props (wired by `Plan`, below) are what the store
 * reads instead.
 */
const usePlanMutations = (
  filePath: string,
  mode: string,
  onFormatNotice: (notice: FormatNotice | undefined) => void,
) => {
  const utils = trpc.useUtils()
  const writeNote = trpc.writeNote.useMutation({
    onSettled: () => utils.readSteeringFile.invalidate({ filePath, mode }),
  })
  const setValue = trpc.setValue.useMutation({
    onSettled: () => utils.readSteeringFile.invalidate({ filePath, mode }),
  })
  const done = trpc.done.useMutation()

  const onCommitAnswer =
    (anchor: SteeringAnchor, opts: { readonly checked?: boolean; readonly text?: string }) =>
    (cas: CasTokens): Promise<unknown> =>
      setValue.mutateAsync({ filePath, ...cas, mode, anchor, ...opts }).then((result) => {
        onFormatNotice(result.formatNotice)
        return result
      })

  const onSaveNote =
    (anchor: SteeringAnchor, text: string) =>
    (cas: CasTokens): Promise<unknown> =>
      writeNote.mutateAsync({ filePath, ...cas, mode, anchor, text }).then((result) => {
        onFormatNotice(result.formatNotice)
        return result
      })

  const onDoneNote =
    (anchor: SteeringAnchor, text: string) =>
    (cas: CasTokens): Promise<unknown> =>
      done.mutateAsync({ note: { filePath, ...cas, mode, anchor, text } })

  /** The Done control's own trigger — no anchor/text, no tokens: there is nothing to compare-and-swap when there's nothing to write. */
  const onDone = (): Promise<unknown> => done.mutateAsync({})

  return { onCommitAnswer, onSaveNote, onDoneNote, onDone, isDone: done.isSuccess }
}

const planViewDataProps = (
  data: { readonly view?: SteeringView; readonly contentHash?: string } | undefined,
) => ({ view: data?.view, contentHash: data?.contentHash ?? "" })

/** `Plan`'s own inner render, a child of its `WriteStoreProvider` — reads the write store (`useSaveIndicatorProps`/`pendingCount`), which only a descendant of the provider can do. */
const PlanInner = ({
  filePath,
  mode,
  data,
  isLoading,
  error,
}: PlanProps & {
  readonly data: { readonly view?: SteeringView; readonly contentHash?: string } | undefined
  readonly isLoading: boolean
  readonly error: unknown
}) => {
  const indicatorProps = useSaveIndicatorProps()
  const pending = useWriteStore((s) => s.pendingCount)
  const [formatNotice, setFormatNotice] = useState<FormatNotice | undefined>(undefined)
  const { onCommitAnswer, onSaveNote, onDoneNote, onDone, isDone } = usePlanMutations(
    filePath,
    mode,
    setFormatNotice,
  )

  return (
    <>
      <SaveIndicator {...indicatorProps} />
      <FormatNoticeBanner notice={formatNotice} onDismiss={() => setFormatNotice(undefined)} />
      {isDone ? (
        <HandedBackPanel />
      ) : (
        <PlanView
          {...planViewDataProps(data)}
          filePath={filePath}
          isLoading={isLoading}
          readError={error}
          onSaveNote={onSaveNote}
          onDoneNote={onDoneNote}
          onDone={onDone}
          onCommitAnswer={onCommitAnswer}
          busy={pending > 0}
        />
      )}
    </>
  )
}

/**
 * The real plan screen: fetches content/`view`/tokens through
 * `readSteeringFile` OUTSIDE the write store, so its own `tokens`/
 * `refetchTokens` can be handed to `WriteStoreProvider` as props — the store
 * then owns every compare-and-swap concern for every write beneath it.
 * Mounts its own provider (package 03's own isolation requirement: two `Plan`
 * screens mounted side by side never share one store).
 */
export const Plan = ({ filePath, mode }: PlanProps) => {
  const utils = trpc.useUtils()
  const query = trpc.readSteeringFile.useQuery({ filePath, mode })

  // `fetch`, never `invalidate` — the store's own retry needs the fresh
  // tokens back as a VALUE to retry with; `onSettled`'s own `invalidate`
  // (inside `usePlanMutations`) already populates the same cache entry, so
  // the two don't fight.
  const refetchTokens = async (): Promise<CasTokens> => {
    const fresh = await utils.readSteeringFile.fetch({ filePath, mode })
    return { expectedHeadSha: fresh.headSha, expectedContentHash: fresh.contentHash }
  }

  return (
    <WriteStoreProvider tokens={query.data} refetchTokens={refetchTokens}>
      <PlanInner
        filePath={filePath}
        mode={mode}
        data={query.data}
        isLoading={query.isLoading}
        error={query.error}
      />
    </WriteStoreProvider>
  )
}
