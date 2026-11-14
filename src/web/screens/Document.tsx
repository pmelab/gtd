import { useState } from "react"
import type { SteeringAnchor, SteeringView, SteeringViewNode } from "../../steering/index.js"
import { Button } from "../Button.js"
import { Notice } from "../Notice.js"
import { NoteSheet } from "../NoteSheet.js"
import { messageForReadRefusal, SaveIndicator, useSaveIndicatorProps } from "../Refusal.js"
import { readRefusalFrom, trpc } from "../api.js"
import type { CasTokens } from "../staleRetry.js"
import { cellKey, useWriteStore, WriteStoreProvider } from "../writeStore.js"
import { DiffBody } from "./Hunk.js"
import { ProseBlocks } from "./ProseBlock.js"

type TokenGuardedWrite = (tokens: CasTokens) => Promise<unknown>

interface BoxValue {
  readonly checked?: boolean
  readonly text?: string
}

/** Past any document's last line: the server appends a paragraph there. */
const APPEND_LINE = Number.MAX_SAFE_INTEGER

const EMOJI: Readonly<Record<string, string>> = {
  "review-checklist": "🔍",
  "single-select": "🔘",
  "multi-select": "☑️",
  boolean: "❔",
}

const isWidget = (node: SteeringViewNode): boolean =>
  node.status !== undefined && EMOJI[node.status] !== undefined

/** Consecutive prose blocks render together; each widget renders alone. */
const runsOf = (nodes: readonly SteeringViewNode[]): (readonly SteeringViewNode[])[] =>
  nodes.reduce<SteeringViewNode[][]>((runs, node) => {
    const last = runs[runs.length - 1]
    if (!isWidget(node) && last !== undefined && !isWidget(last[0]!)) last.push(node)
    else runs.push([node])
    return runs
  }, [])

interface WidgetActions {
  readonly checkedOf: (node: SteeringViewNode) => boolean
  readonly textOf: (node: SteeringViewNode) => string
  readonly set: (node: SteeringViewNode, value: BoxValue) => void
  readonly openNote: (anchor: SteeringAnchor) => void
}

const HunkDiff = ({ node }: { readonly node: SteeringViewNode }) => {
  const query = trpc.diff.useQuery(
    {
      path: node.path ?? "",
      ...(node.line !== undefined ? { line: node.line } : {}),
      ...(node.endLine !== undefined ? { endLine: node.endLine } : {}),
    },
    { enabled: node.path !== undefined },
  )
  return <DiffBody diff={query.data} />
}

const CustomAnswer = ({
  node,
  type,
  actions,
}: {
  readonly node: SteeringViewNode
  readonly type: "radio" | "checkbox"
  readonly actions: WidgetActions
}) => {
  const [text, setText] = useState(actions.textOf(node))
  return (
    <li className="flex items-center gap-2 py-1" data-testid="widget-custom">
      <input
        type={type}
        aria-label="Your own answer"
        checked={actions.checkedOf(node)}
        onChange={(e) => actions.set(node, { checked: e.target.checked, text })}
      />
      <input
        type="text"
        className="min-w-0 flex-1 rounded border border-border px-2 py-1"
        placeholder="Your own answer"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        variant="secondary"
        data-testid="widget-custom-save"
        onClick={() => actions.set(node, { checked: true, text })}
      >
        Save
      </Button>
    </li>
  )
}

const OptionRow = ({
  node,
  type,
  actions,
}: {
  readonly node: SteeringViewNode
  readonly type: "radio" | "checkbox"
  readonly actions: WidgetActions
}) => (
  <li className="py-1">
    <label className="flex items-start gap-2">
      <input
        type={type}
        checked={actions.checkedOf(node)}
        onChange={(e) => actions.set(node, { checked: type === "radio" || e.target.checked })}
      />
      <span>{node.title}</span>
    </label>
  </li>
)

const HunkRow = ({
  node,
  actions,
}: {
  readonly node: SteeringViewNode
  readonly actions: WidgetActions
}) => (
  <li className="py-1" data-testid="widget-hunk">
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        checked={actions.checkedOf(node)}
        onChange={(e) => actions.set(node, { checked: e.target.checked })}
      />
      <span className="break-all font-mono text-small">{node.title}</span>
    </label>
    <details className="mt-1">
      <summary className="cursor-pointer text-small text-muted">Show the change</summary>
      <HunkDiff node={node} />
    </details>
  </li>
)

const WidgetHeader = ({
  node,
  actions,
}: {
  readonly node: SteeringViewNode
  readonly actions: WidgetActions
}) => (
  <header className="flex items-start justify-between gap-2">
    <h2 className="m-0 text-body font-semibold">
      {EMOJI[node.status ?? ""]} {node.title}
      {node.answered === false && (
        <span className="ml-2 text-small font-normal text-muted" data-testid="widget-required">
          needs an answer
        </span>
      )}
    </h2>
    <Button
      variant="ghost"
      data-testid="widget-note-open"
      onClick={() => actions.openNote(node.anchor)}
    >
      Note
    </Button>
  </header>
)

const WidgetItem = ({
  kind,
  node,
  actions,
}: {
  readonly kind: string
  readonly node: SteeringViewNode
  readonly actions: WidgetActions
}) => {
  const type = kind === "single-select" ? "radio" : "checkbox"
  if (kind === "review-checklist") return <HunkRow node={node} actions={actions} />
  if (node.status === "custom") return <CustomAnswer node={node} type={type} actions={actions} />
  return <OptionRow node={node} type={type} actions={actions} />
}

const WidgetText = ({ node }: { readonly node: SteeringViewNode }) => (
  <>
    {node.detail !== undefined && (
      <p className="my-2 whitespace-pre-wrap text-small">{node.detail}</p>
    )}
    {node.note !== undefined && (
      <p className="my-2 rounded bg-surface p-2 text-small" data-testid="widget-note">
        {node.note}
      </p>
    )}
  </>
)

const WidgetCard = ({
  node,
  actions,
}: {
  readonly node: SteeringViewNode
  readonly actions: WidgetActions
}) => {
  const kind = node.status ?? ""
  return (
    <section data-testid={`widget-${kind}`} className="border-b border-border p-3">
      <WidgetHeader node={node} actions={actions} />
      <WidgetText node={node} />
      <ul className="m-0 list-none p-0">
        {(node.children ?? []).map((child, i) => (
          <WidgetItem key={i} kind={kind} node={child} actions={actions} />
        ))}
      </ul>
    </section>
  )
}

const EmptyDocumentCapture = ({ onSave }: { readonly onSave: (text: string) => void }) => {
  const [text, setText] = useState("")
  return (
    <div className="rounded border border-border p-3">
      <textarea
        data-testid="document-empty-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-32 w-full resize-y"
      />
      <div className="mt-2 flex justify-end">
        <Button variant="primary" data-testid="document-empty-save" onClick={() => onSave(text)}>
          Save
        </Button>
      </div>
    </div>
  )
}

export interface DocumentViewProps {
  readonly view: SteeringView | undefined
  readonly filePath: string
  readonly isLoading: boolean
  readonly readError?: unknown
  readonly onSet?: (anchor: SteeringAnchor, value: BoxValue) => TokenGuardedWrite
  readonly onSaveNote?: (anchor: SteeringAnchor, text: string) => TokenGuardedWrite
  readonly onDone?: () => Promise<unknown>
  readonly busy?: boolean | undefined
}

const loadingMessage = (isLoading: boolean, readError: unknown): string => {
  if (isLoading) return "Loading the file…"
  const refusal = readError !== undefined ? readRefusalFrom(readError) : undefined
  return refusal !== undefined ? messageForReadRefusal(refusal) : "Could not load the file."
}

/** A steering file as the person sees it: prose to read and note, widgets to answer, in file order. */
// fallow-ignore-next-line complexity
export const DocumentView = ({
  view,
  filePath,
  isLoading,
  readError,
  onSet,
  onSaveNote,
  onDone,
  busy,
}: DocumentViewProps) => {
  const [noteAnchor, setNoteAnchor] = useState<SteeringAnchor | undefined>(undefined)
  const overlay = useWriteStore((s) => s.overlay)
  const save = useWriteStore((s) => s.save)

  if (view === undefined) {
    return (
      <Notice tone={isLoading ? "info" : "error"}>{loadingMessage(isLoading, readError)}</Notice>
    )
  }

  const valueOf = (node: SteeringViewNode): BoxValue | undefined => {
    const value = overlay[cellKey(filePath, node.anchor, "value")]?.value
    return typeof value === "object" && value !== null ? (value as BoxValue) : undefined
  }
  const siblingsOf = (node: SteeringViewNode): readonly SteeringViewNode[] =>
    view.nodes.find((n) => n.children?.includes(node))?.children ?? []

  const write = (anchor: SteeringAnchor, value: BoxValue): void => {
    save({
      cell: cellKey(filePath, anchor, "value"),
      optimistic: value,
      write: onSet === undefined ? undefined : onSet(anchor, value),
    }).catch(() => {})
  }

  // A single select shows one pick at once: ticking one clears the others' ticks on screen.
  const clearSiblings = (node: SteeringViewNode): void => {
    const parent = view.nodes.find((n) => n.children?.includes(node))
    if (parent?.status !== "single-select") return
    for (const sibling of siblingsOf(node).filter((s) => s !== node)) {
      save({
        cell: cellKey(filePath, sibling.anchor, "value"),
        optimistic: { checked: false },
      }).catch(() => {})
    }
  }

  const actions: WidgetActions = {
    // A later tick of a sibling radio unticks this one: the newest radio write wins.
    checkedOf: (node) => valueOf(node)?.checked ?? node.checked === true,
    textOf: (node) => valueOf(node)?.text ?? node.title,
    set: (node, value) => {
      write(node.anchor, value)
      if (value.checked === true) clearSiblings(node)
    },
    openNote: setNoteAnchor,
  }

  const saveNote = (anchor: SteeringAnchor, text: string): void => {
    save({
      cell: cellKey(filePath, anchor, "note"),
      optimistic: text,
      write: onSaveNote === undefined ? undefined : onSaveNote(anchor, text),
    }).catch(() => {})
  }

  const saveEmpty = (text: string): void => {
    const anchor: SteeringAnchor = { kind: "paragraph", line: APPEND_LINE }
    save({
      cell: cellKey(filePath, anchor, "note"),
      optimistic: text,
      write: onSet === undefined ? undefined : onSet(anchor, { text }),
    }).catch(() => {})
  }

  const runDone = (): void => {
    if (onDone === undefined) return
    save({ cell: cellKey(filePath, undefined, "done"), optimistic: true, mutate: onDone }).catch(
      () => {},
    )
  }

  return (
    <>
      <div data-testid="document-screen" className="flex h-full min-h-0 flex-1 flex-col">
        <div data-testid="document-scroll" className="min-h-0 flex-1 overflow-auto">
          {view.nodes.length === 0 ? (
            <EmptyDocumentCapture onSave={saveEmpty} />
          ) : (
            runsOf(view.nodes).map((run, i) =>
              isWidget(run[0]!) ? (
                <WidgetCard key={i} node={run[0]!} actions={actions} />
              ) : (
                <ProseBlocks
                  key={i}
                  nodes={run}
                  noteOverrides={{}}
                  onOpenNote={(node) => setNoteAnchor(node.anchor)}
                />
              ),
            )
          )}
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
      {noteAnchor !== undefined && (
        <NoteSheet
          anchor={noteAnchor}
          onSave={(anchor, text) => {
            setNoteAnchor(undefined)
            saveNote(anchor, text)
          }}
          onDismiss={() => setNoteAnchor(undefined)}
        />
      )}
    </>
  )
}

const HandedBackPanel = () => (
  <Notice data-testid="handed-back-panel" role="status" aria-live="polite">
    Handed back — this turn is done.
  </Notice>
)

const useDocumentMutations = (filePath: string) => {
  const utils = trpc.useUtils()
  const invalidate = () => utils.readSteeringFile.invalidate({ filePath })
  const setValue = trpc.setValue.useMutation({ onSettled: invalidate })
  const writeNote = trpc.writeNote.useMutation({ onSettled: invalidate })
  const done = trpc.done.useMutation()
  const onSet =
    (anchor: SteeringAnchor, value: BoxValue) =>
    (cas: CasTokens): Promise<unknown> =>
      setValue.mutateAsync({ filePath, ...cas, anchor, ...value })
  const onSaveNote =
    (anchor: SteeringAnchor, text: string) =>
    (cas: CasTokens): Promise<unknown> =>
      writeNote.mutateAsync({ filePath, ...cas, anchor, text })
  return { onSet, onSaveNote, onDone: () => done.mutateAsync({}), isDone: done.isSuccess }
}

const DocumentInner = ({
  filePath,
  data,
  isLoading,
  error,
}: {
  readonly filePath: string
  readonly data: { readonly view?: SteeringView } | undefined
  readonly isLoading: boolean
  readonly error: unknown
}) => {
  const indicatorProps = useSaveIndicatorProps()
  const pending = useWriteStore((s) => s.pendingCount)
  const { onSet, onSaveNote, onDone, isDone } = useDocumentMutations(filePath)
  return (
    <>
      <SaveIndicator {...indicatorProps} />
      {isDone ? (
        <HandedBackPanel />
      ) : (
        <DocumentView
          view={data?.view}
          filePath={filePath}
          isLoading={isLoading}
          readError={error}
          onSet={onSet}
          onSaveNote={onSaveNote}
          onDone={onDone}
          busy={pending > 0}
        />
      )}
    </>
  )
}

/** The screen for every widget steering file. */
export const Document = ({ filePath }: { readonly filePath: string }) => {
  const utils = trpc.useUtils()
  const query = trpc.readSteeringFile.useQuery({ filePath })
  const refetchTokens = async (): Promise<CasTokens> => {
    const fresh = await utils.readSteeringFile.fetch({ filePath })
    return { expectedHeadSha: fresh.headSha, expectedContentHash: fresh.contentHash }
  }
  return (
    <WriteStoreProvider tokens={query.data} refetchTokens={refetchTokens}>
      <DocumentInner
        filePath={filePath}
        data={query.data}
        isLoading={query.isLoading}
        error={query.error}
      />
    </WriteStoreProvider>
  )
}
