import { useState } from "react"
import { steeringFormatFor } from "../../steering/index.js"
import type { SteeringAnchor, SteeringView } from "../../steering/index.js"
import { Button } from "../Button.js"
import { FormatNoticeBanner, type FormatNotice } from "../FormatNotice.js"
import { Notice } from "../Notice.js"
import { NoteSheet } from "../NoteSheet.js"
import { existingNoteFor } from "../notes.js"
import { messageForReadRefusal, SaveIndicator, useSaveIndicatorProps } from "../Refusal.js"
import { readRefusalFrom, trpc } from "../api.js"
import type { CasTokens } from "../staleRetry.js"
import { cellKey, useWriteStore, WriteStoreProvider } from "../writeStore.js"
import { ProseBlocks } from "./ProseBlock.js"

/** A write guarded by the store's own compare-and-swap retry — see `writeStore.ts#SaveArgs.write`'s own doc comment. */
type TokenGuardedWrite = (tokens: CasTokens) => Promise<unknown>

/**
 * The empty-document save's own anchor line: `freeform.ts#freeFormApply`'s
 * guard only appends when `anchor.line` is at or beyond the document's own
 * last line, a value this client never has. `Number.MAX_SAFE_INTEGER`
 * always reaches the append branch regardless of the file's real length.
 */
const APPEND_LINE = Number.MAX_SAFE_INTEGER

const freeFormLoadingMessage = (isLoading: boolean, readError: unknown): string => {
  if (isLoading) return "Loading the file…"
  const refusal = readError !== undefined ? readRefusalFrom(readError) : undefined
  return refusal !== undefined ? messageForReadRefusal(refusal) : "Could not load the file."
}

/** The empty-document branch: a bare textfield plus a single primary Save. */
const EmptyDocumentCapture = ({ onSave }: { readonly onSave: (text: string) => void }) => {
  const [text, setText] = useState("")
  return (
    <div className="rounded border border-border p-3">
      <textarea
        data-testid="freeform-empty-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-32 w-full resize-y"
      />
      <div className="mt-2 flex justify-end">
        <Button variant="primary" data-testid="freeform-empty-save" onClick={() => onSave(text)}>
          Save
        </Button>
      </div>
    </div>
  )
}

/** The modal note sheet, rendered OVER the screen it belongs to. */
const FreeFormNoteSheet = ({
  view,
  anchor,
  noteOverrides,
  onClose,
  onSaveNote,
}: {
  readonly view: SteeringView
  readonly anchor: SteeringAnchor | undefined
  readonly noteOverrides: Readonly<Record<number, string>>
  readonly onClose: () => void
  readonly onSaveNote: ((anchor: SteeringAnchor, text: string) => void) | undefined
}) => {
  if (anchor === undefined) return null
  const existingNote = existingNoteFor(view.nodes, anchor, noteOverrides)
  return (
    <NoteSheet
      anchor={anchor}
      {...(existingNote !== undefined ? { note: existingNote } : {})}
      onSave={(anchor, text) => {
        onClose()
        onSaveNote?.(anchor, text)
      }}
      onDismiss={onClose}
    />
  )
}

/** The `plan-done` footer row — present whenever `onDone` is wired up. */
const FreeFormDoneRow = ({
  onDone,
  busy,
}: {
  readonly onDone: () => void
  readonly busy?: boolean | undefined
}) => (
  <div
    data-testid="plan-done-row"
    className="flex shrink-0 items-center justify-end border-t border-border p-3"
  >
    <Button variant="primary" data-testid="plan-done" onClick={onDone} disabled={busy}>
      Done
    </Button>
  </div>
)

export interface FreeFormViewProps {
  readonly view: SteeringView | undefined
  readonly filePath: string
  readonly isLoading: boolean
  readonly readError?: unknown
  readonly mode: string | undefined
  readonly onSave?: (line: number, text: string) => TokenGuardedWrite
  readonly onDone?: () => Promise<unknown>
  readonly onSaveNote?: (anchor: SteeringAnchor, text: string) => TokenGuardedWrite
  /** Package 03 Task 1's single `busy` boolean, threaded from the store's own pending count. */
  readonly busy?: boolean | undefined
}

// fallow-ignore-next-line complexity
export const FreeFormView = ({
  view,
  filePath,
  isLoading,
  readError,
  mode,
  onSave,
  onDone,
  onSaveNote,
  busy,
}: FreeFormViewProps) => {
  const [noteSheetAnchor, setNoteSheetAnchor] = useState<SteeringAnchor | undefined>(undefined)
  const overlay = useWriteStore((s) => s.overlay)
  const save = useWriteStore((s) => s.save)

  if (view === undefined) {
    return (
      <Notice tone={isLoading ? "info" : "error"}>
        {freeFormLoadingMessage(isLoading, readError)}
      </Notice>
    )
  }

  const noteOverrides: Record<number, string> = {}
  for (const node of view.nodes) {
    if (node.anchor.kind !== "paragraph") continue
    const value = overlay[cellKey(filePath, node.anchor, "note")]?.value
    if (typeof value === "string") noteOverrides[node.anchor.line] = value
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
      write: onSave === undefined ? undefined : onSave(APPEND_LINE, text),
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
      <div data-testid="freeform-screen" className="flex h-full min-h-0 flex-1 flex-col">
        {mode !== undefined && steeringFormatFor(mode) === undefined && (
          <Notice data-testid="freeform-fallback-notice">
            {`"${mode}" has no screen — editing as plain markdown`}
          </Notice>
        )}
        <div data-testid="freeform-scroll" className="min-h-0 flex-1 overflow-auto">
          {view.nodes.length === 0 ? (
            <EmptyDocumentCapture onSave={saveEmpty} />
          ) : (
            <ProseBlocks
              nodes={view.nodes}
              noteOverrides={noteOverrides}
              onOpenNote={(n) => setNoteSheetAnchor(n.anchor)}
            />
          )}
        </div>
        {onDone !== undefined && <FreeFormDoneRow onDone={runDone} busy={busy} />}
      </div>
      <FreeFormNoteSheet
        view={view}
        anchor={noteSheetAnchor}
        noteOverrides={noteOverrides}
        onClose={() => setNoteSheetAnchor(undefined)}
        onSaveNote={saveNote}
      />
    </>
  )
}

/** The terminal panel after `done` resolves. */
const HandedBackPanel = () => (
  <Notice data-testid="handed-back-panel" role="status" aria-live="polite">
    Handed back — this turn is done.
  </Notice>
)

export interface FreeFormProps {
  readonly filePath: string
  readonly mode: string | undefined
}

/** Every raw write `FreeForm` wires up — mirrors `Plan.tsx#usePlanMutations`'s identical shape: a plain `trpc` call curried over its own anchor/line, no token/retry logic of its own. */
const useFreeFormMutations = (
  filePath: string,
  mode: string | undefined,
  onWriteSuccess: (formatNotice?: FormatNotice) => void,
) => {
  const utils = trpc.useUtils()
  const setValue = trpc.setValue.useMutation({
    onSettled: () => utils.readSteeringFile.invalidate({ filePath, mode }),
  })
  const writeNote = trpc.writeNote.useMutation({
    onSettled: () => utils.readSteeringFile.invalidate({ filePath, mode }),
  })
  const done = trpc.done.useMutation()

  const onSave =
    (line: number, text: string) =>
    (cas: CasTokens): Promise<unknown> => {
      const anchor: SteeringAnchor = { kind: "paragraph", line }
      return setValue.mutateAsync({ filePath, ...cas, mode, anchor, text }).then((result) => {
        onWriteSuccess(result.formatNotice)
        return result
      })
    }

  const onSaveNote =
    (anchor: SteeringAnchor, text: string) =>
    (cas: CasTokens): Promise<unknown> =>
      writeNote.mutateAsync({ filePath, ...cas, mode, anchor, text }).then((result) => {
        onWriteSuccess(result.formatNotice)
        return result
      })

  const onDone = (): Promise<unknown> => done.mutateAsync({})

  return { onSave, onSaveNote, onDone, isDone: done.isSuccess }
}

/** `FreeForm`'s own inner render, a child of its `WriteStoreProvider`. */
const FreeFormInner = ({
  filePath,
  mode,
  data,
  isLoading,
  error,
}: FreeFormProps & {
  readonly data: { readonly view?: SteeringView } | undefined
  readonly isLoading: boolean
  readonly error: unknown
}) => {
  const indicatorProps = useSaveIndicatorProps()
  const pending = useWriteStore((s) => s.pendingCount)
  const [formatNotice, setFormatNotice] = useState<FormatNotice | undefined>(undefined)
  const { onSave, onSaveNote, onDone, isDone } = useFreeFormMutations(
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
        <FreeFormView
          view={data?.view}
          filePath={filePath}
          isLoading={isLoading}
          readError={error}
          mode={mode}
          onSave={onSave}
          onDone={onDone}
          onSaveNote={onSaveNote}
          busy={pending > 0}
        />
      )}
    </>
  )
}

/**
 * The real free-form screen: fetches content/`view`/tokens through
 * `readSteeringFile` OUTSIDE the write store, handing `tokens`/
 * `refetchTokens` to `WriteStoreProvider` as props — see `Plan.tsx#Plan`'s
 * identical doc comment. `App.tsx` renders this for any human rest whose
 * `mode` isn't `"review"`/`"qa"`.
 */
export const FreeForm = ({ filePath, mode }: FreeFormProps) => {
  const utils = trpc.useUtils()
  const query = trpc.readSteeringFile.useQuery({ filePath, mode })

  const refetchTokens = async (): Promise<CasTokens> => {
    const fresh = await utils.readSteeringFile.fetch({ filePath, mode })
    return { expectedHeadSha: fresh.headSha, expectedContentHash: fresh.contentHash }
  }

  return (
    <WriteStoreProvider tokens={query.data} refetchTokens={refetchTokens}>
      <FreeFormInner
        filePath={filePath}
        mode={mode}
        data={query.data}
        isLoading={query.isLoading}
        error={query.error}
      />
    </WriteStoreProvider>
  )
}
