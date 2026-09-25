import { useState } from "react"
import { steeringFormatFor } from "../../steering/index.js"
import type { SteeringAnchor, SteeringView } from "../../steering/index.js"
import { Button } from "../Button.js"
import { useContentHashOverride } from "../contentHashOverride.js"
import { FormatNoticeBanner, type FormatNotice } from "../FormatNotice.js"
import { Notice } from "../Notice.js"
import { NoteSheet } from "../NoteSheet.js"
import { existingNoteFor, optimisticNoteSave } from "../notes.js"
import { messageForReadRefusal, RefusalBanner, useRefusal } from "../Refusal.js"
import { readRefusalFrom, trpc } from "../api.js"
import { withStaleShaRetry, type CasTokens } from "../staleRetry.js"
import { ProseBlocks } from "./ProseBlock.js"

/**
 * The empty-document save's own anchor line: `freeform.ts#freeFormApply`'s
 * guard only appends when `anchor.line` is at or beyond the document's OWN
 * last line — a value this client never has (its only view of the document
 * is `view.nodes`, never raw content/line count). `Number.MAX_SAFE_INTEGER`
 * is always past any real document's last line, so it reaches the append
 * branch unconditionally regardless of how long the file actually is,
 * without this client ever needing to know that length.
 */
const APPEND_LINE = Number.MAX_SAFE_INTEGER

const freeFormLoadingMessage = (isLoading: boolean, readError: unknown): string => {
  if (isLoading) return "Loading the file…"
  const refusal = readError !== undefined ? readRefusalFrom(readError) : undefined
  return refusal !== undefined ? messageForReadRefusal(refusal) : "Could not load the file."
}

/**
 * The empty-document branch: a bare textfield plus a single primary Save —
 * no Cancel (an empty document has no closed state to return to) and no
 * `autoFocus` (iOS Safari refuses programmatic focus without a user
 * gesture, so autofocus would work on desktop and silently not on the
 * device this UI is built for). Text lives in React state alone — the
 * accepted regression is an iOS tab eviction mid-capture losing the typed
 * text silently, traded for not carrying a whole `localStorage` draft store
 * for a single field.
 */
const EmptyDocumentCapture = ({
  onSave,
}: {
  readonly onSave: (text: string) => Promise<unknown>
}) => {
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
        <Button
          variant="primary"
          data-testid="freeform-empty-save"
          onClick={() => {
            onSave(text).catch(() => {})
          }}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

/** The modal note sheet, rendered OVER the screen it belongs to (never instead of it) once a block's note gesture opens one — split out so `FreeFormView` itself stays a single dispatch. */
// fallow-ignore-next-line complexity
const FreeFormNoteSheet = ({
  view,
  anchor,
  noteOverrides,
  setNoteOverrides,
  onClose,
  onSaveNote,
  onRefusal,
}: {
  readonly view: SteeringView
  readonly anchor: SteeringAnchor | undefined
  readonly noteOverrides: Readonly<Record<number, string>>
  readonly setNoteOverrides: (
    update: (prev: Record<number, string>) => Record<number, string>,
  ) => void
  readonly onClose: () => void
  readonly onSaveNote: ((anchor: SteeringAnchor, text: string) => Promise<unknown>) | undefined
  readonly onRefusal: ((error: unknown, retry?: () => Promise<unknown>) => void) | undefined
}) => {
  if (anchor === undefined) return null
  const existingNote = existingNoteFor(view.nodes, anchor, noteOverrides)
  return (
    <NoteSheet
      anchor={anchor}
      {...(existingNote !== undefined ? { note: existingNote } : {})}
      onSave={optimisticNoteSave({
        setOverrides: setNoteOverrides,
        close: onClose,
        ...(onSaveNote !== undefined ? { write: onSaveNote } : {}),
        ...(onRefusal !== undefined ? { onRefusal } : {}),
      })}
      onDismiss={onClose}
    />
  )
}

/** The empty-document capture's own `onSave` wrapper: reports a write refusal through the screen's shared `onRefusal` banner, the same shape every other write path here uses. */
const wrapEmptySave = (
  onSave: ((line: number, text: string) => Promise<unknown>) | undefined,
  onRefusal: ((error: unknown, retry?: () => Promise<unknown>) => void) | undefined,
) => {
  return (text: string): Promise<unknown> => {
    if (onSave === undefined) return Promise.resolve()
    return onSave(APPEND_LINE, text).catch((error: unknown) => {
      onRefusal?.(error, () => onSave(APPEND_LINE, text))
      throw error
    })
  }
}

/** The `plan-done` footer row — present whenever `onDone` is wired up, mirroring `Plan.tsx`'s identical control. */
const FreeFormDoneRow = ({ onDone }: { readonly onDone: () => void }) => (
  <div
    data-testid="plan-done-row"
    className="flex shrink-0 items-center justify-end border-t border-border p-3"
  >
    <Button variant="primary" data-testid="plan-done" onClick={onDone}>
      Done
    </Button>
  </div>
)

/**
 * Presentational free-form screen — takes `view`/`filePath` as props so
 * `FreeForm.stories.tsx` can drive every shape with plain data, mirroring
 * `Plan.tsx#PlanView`'s own split. No findings surface anywhere here: a
 * mode-less file validates nothing (`freeform.ts`'s own `validate` is a
 * constant `[]`), so there is nothing to render for it. Reads
 * read-plus-note, exactly like Plan's own prose branch — the empty-document
 * textfield is the only write path left on this screen besides a note.
 */
export interface FreeFormViewProps {
  readonly view: SteeringView | undefined
  readonly filePath: string
  readonly isLoading: boolean
  readonly readError?: unknown
  /** The step's own `mode`, when present but unregistered (this screen never renders for `"review"`/`"qa"` — `App.tsx` dispatches those elsewhere) — named in the header rather than hidden, per the package's own "typo'd mode degrades, never silently" requirement. */
  readonly mode: string | undefined
  readonly onSave?: (line: number, text: string) => Promise<unknown>
  readonly onDone?: () => Promise<unknown>
  /** The note seam's own write-through — same `writeNote`/`annotate` path `Plan.tsx#PlanViewProps.onSaveNote` uses. */
  readonly onSaveNote?: (anchor: SteeringAnchor, text: string) => Promise<unknown>
  readonly onRefusal?: (error: unknown, retry?: () => Promise<unknown>) => void
}

// fallow-ignore-next-line complexity
export const FreeFormView = ({
  view,
  filePath: _filePath,
  isLoading,
  readError,
  mode,
  onSave,
  onDone,
  onSaveNote,
  onRefusal,
}: FreeFormViewProps) => {
  const [noteOverrides, setNoteOverrides] = useState<Record<number, string>>({})
  const [noteSheetAnchor, setNoteSheetAnchor] = useState<SteeringAnchor | undefined>(undefined)

  if (view === undefined) {
    return (
      <Notice tone={isLoading ? "info" : "error"}>
        {freeFormLoadingMessage(isLoading, readError)}
      </Notice>
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
            <EmptyDocumentCapture onSave={wrapEmptySave(onSave, onRefusal)} />
          ) : (
            <ProseBlocks
              nodes={view.nodes}
              noteOverrides={noteOverrides}
              onOpenNote={(n) => setNoteSheetAnchor(n.anchor)}
            />
          )}
        </div>
        {onDone !== undefined && <FreeFormDoneRow onDone={() => onDone()} />}
      </div>
      <FreeFormNoteSheet
        view={view}
        anchor={noteSheetAnchor}
        noteOverrides={noteOverrides}
        setNoteOverrides={setNoteOverrides}
        onClose={() => setNoteSheetAnchor(undefined)}
        onSaveNote={onSaveNote}
        onRefusal={onRefusal}
      />
    </>
  )
}

/**
 * The terminal panel after `done` resolves — identical in shape to
 * `Plan.tsx#HandedBackPanel`/`Review.tsx#HandedBackPanel`; kept as a third
 * small copy for the same reason those two stay separate (each screen owns
 * its own file).
 */
const HandedBackPanel = () => (
  <Notice data-testid="handed-back-panel" role="status" aria-live="polite">
    Handed back — this turn is done.
  </Notice>
)

export interface FreeFormProps {
  readonly filePath: string
  /** Absent for a truly mode-less rest, or an unregistered mode name — either way this screen falls back to editing the file as plain markdown (`steering/index.ts#steeringFormatOrFreeForm`, mirrored server-side). */
  readonly mode: string | undefined
}

/** Every mutation `FreeForm` wires up — mirrors `Plan.tsx#usePlanMutations`'s identical shape, using `setValue` (`SteeringFormat.apply`) for the empty-document append since free-form has no note-shaped `annotate` call here. Task 1's own token bookkeeping (the "consecutive writes with no refetch" override, and dropping it on a `stale-token` refusal) now lives in the shared `contentHashOverride.ts` hook — see its own doc comment for the WHY, kept there once for all three screens instead of copied here. */
const useFreeFormMutations = (
  filePath: string,
  mode: string | undefined,
  data: { readonly headSha: string; readonly contentHash: string } | undefined,
  /** Task 6/5's own client-side sinks: called on every successful write with the post-format `contentHash` (token swap) and, when the configured `ui.format` command failed, the `formatNotice` naming it — never on a refusal, which the caller's own `.catch` handles separately. */
  onWriteSuccess: (contentHash: string, formatNotice?: FormatNotice) => void,
) => {
  const override = useContentHashOverride()
  const utils = trpc.useUtils()
  const setValue = trpc.setValue.useMutation({
    onSettled: () => utils.readSteeringFile.invalidate({ filePath, mode }),
  })
  const writeNote = trpc.writeNote.useMutation({
    onSettled: () => utils.readSteeringFile.invalidate({ filePath, mode }),
  })
  const done = trpc.done.useMutation()

  const refetchTokens = async (): Promise<CasTokens> => {
    const fresh = await utils.readSteeringFile.fetch({ filePath, mode })
    override.clear()
    return { expectedHeadSha: fresh.headSha, expectedContentHash: fresh.contentHash }
  }

  /** Every successful `setValue`/`writeNote` result funnels through here: swaps the local token override for the post-format hash the server just returned, and surfaces a format-command failure (if any) to the caller. */
  const handleWriteResult = (result: {
    readonly contentHash: string
    readonly formatNotice?: FormatNotice
  }): void => {
    override.onWriteSuccess(result.contentHash)
    onWriteSuccess(result.contentHash, result.formatNotice)
  }

  const onSave = (line: number, text: string): Promise<unknown> => {
    const tokens = override.casTokensFor(data)
    if (tokens === undefined) return Promise.reject(new Error("no steering file loaded yet"))
    return withStaleShaRetry(
      (cas) =>
        setValue
          .mutateAsync({
            filePath,
            ...cas,
            mode,
            anchor: { kind: "paragraph", line },
            text,
          })
          .then((result) => {
            handleWriteResult(result)
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
          handleWriteResult(result)
          return result
        }),
      tokens,
      refetchTokens,
    ).catch((error: unknown) => {
      override.onWriteRefusal(error)
      throw error
    })
  }

  const onDone = (): Promise<unknown> => done.mutateAsync({})

  return { onSave, onSaveNote, onDone, isDone: done.isSuccess }
}

const freeFormViewDataProps = (data: { readonly view?: SteeringView } | undefined) => ({
  view: data?.view,
})

/**
 * The real free-form screen: fetches content/`view`/tokens through
 * `readSteeringFile` — `App.tsx` renders this for any human rest whose
 * `mode` isn't `"review"`/`"qa"` (absent, or an unregistered custom mode).
 */
export const FreeForm = ({ filePath, mode }: FreeFormProps) => {
  const query = trpc.readSteeringFile.useQuery({ filePath, mode })
  const { refusal, saveStatus, showRefusal, dismiss, trackSave, onRetry } = useRefusal()
  // Task 5's own client half: the most recent `ui.format` failure a write
  // surfaced, named so the human knows their edit landed but wasn't
  // reformatted — never a refusal (the write itself succeeded), so this is
  // deliberately separate state from `useRefusal`'s own banner.
  const [formatNotice, setFormatNotice] = useState<FormatNotice | undefined>(undefined)
  const { onSave, onSaveNote, onDone, isDone } = useFreeFormMutations(
    filePath,
    mode,
    query.data,
    (_contentHash, notice) => setFormatNotice(notice),
  )

  const onSaveTracked = (line: number, text: string): Promise<unknown> =>
    trackSave(onSave(line, text))
  const onSaveNoteTracked = (anchor: SteeringAnchor, text: string): Promise<unknown> =>
    trackSave(onSaveNote(anchor, text))
  const onDoneWithRefusal = (): Promise<unknown> =>
    onDone().catch((error: unknown) => {
      showRefusal(error)
    })

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
        <HandedBackPanel />
      ) : (
        <FreeFormView
          {...freeFormViewDataProps(query.data)}
          filePath={filePath}
          isLoading={query.isLoading}
          readError={query.error}
          mode={mode}
          onSave={onSaveTracked}
          onDone={onDoneWithRefusal}
          onSaveNote={onSaveNoteTracked}
          onRefusal={showRefusal}
        />
      )}
    </>
  )
}
