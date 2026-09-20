import { useRef, useState } from "react"
import { steeringFormatFor } from "../../steering/index.js"
import type { SteeringAnchor, SteeringView, SteeringViewNode } from "../../steering/index.js"
import { Button } from "../Button.js"
import { CardList } from "../Card.js"
import { FormatNoticeBanner, type FormatNotice } from "../FormatNotice.js"
import { Notice } from "../Notice.js"
import { NoteSheet } from "../NoteSheet.js"
import { messageForReadRefusal, RefusalBanner, useRefusal } from "../Refusal.js"
import { readRefusalFrom, trpc, writeRefusalFrom } from "../api.js"
import { withStaleShaRetry, type CasTokens } from "../staleRetry.js"
import { ProseBlock } from "./ProseBlock.js"

/**
 * The append row's own anchor line: `freeform.ts#freeFormApply`'s guard only
 * appends when `anchor.line` is at or beyond the document's OWN last line —
 * a value this client never has (its only view of the document is
 * `view.nodes`, never raw content/line count). `Number.MAX_SAFE_INTEGER` is
 * always past any real document's last line, so it reaches the append branch
 * unconditionally regardless of how long the file actually is, without this
 * client ever needing to know that length.
 */
const APPEND_LINE = Number.MAX_SAFE_INTEGER

/** `gtd:freeform-draft:<contentHash>:<line>` — keyed on the file's own `contentHash` (a rewrite starts a fresh draft namespace, mirroring `Plan.tsx#usePlanReadConfirmation`'s identical reasoning) and the block's own anchor line (`APPEND_LINE` for the append row). */
const draftStorageKey = (contentHash: string, line: number): string =>
  `gtd:freeform-draft:${contentHash}:${line}`

const readDraft = (contentHash: string, line: number): string | undefined =>
  localStorage.getItem(draftStorageKey(contentHash, line)) ?? undefined

const writeDraft = (contentHash: string, line: number, text: string): void => {
  localStorage.setItem(draftStorageKey(contentHash, line), text)
}

const clearDraft = (contentHash: string, line: number): void => {
  localStorage.removeItem(draftStorageKey(contentHash, line))
}

/** `node.anchor`'s own line — every free-form `view.nodes` entry carries a `paragraph` anchor (`freeform.ts#freeFormView`), so this only ever falls back to `index` for a malformed node. */
const lineOf = (node: SteeringViewNode, index: number): number =>
  node.anchor.kind === "paragraph" ? node.anchor.line : index

export interface FreeFormViewProps {
  readonly view: SteeringView | undefined
  readonly contentHash: string
  readonly isLoading: boolean
  readonly readError?: unknown
  /** The step's own `mode`, when present but unregistered (this screen never renders for `"review"`/`"qa"` — `App.tsx` dispatches those elsewhere) — named in the header rather than hidden, per the package's own "typo'd mode degrades, never silently" requirement. */
  readonly mode: string | undefined
  readonly onSave?: (line: number, text: string) => Promise<unknown>
  readonly onDelete?: (line: number) => Promise<unknown>
  readonly onDone?: () => Promise<unknown>
  /** The note seam's own write-through — same `writeNote`/`annotate` path `Plan.tsx#PlanViewProps.onSaveNote` uses, kept as a SEPARATE call from `onSave` (which is `setValue`/`apply`, a whole-block replace): a note attaches alongside a block without rewriting its own source text. */
  readonly onSaveNote?: (anchor: SteeringAnchor, text: string) => Promise<unknown>
  readonly onRefusal?: (error: unknown, retry?: () => Promise<unknown>) => void
}

/** One block's editable row: read-only structure plus Edit/Delete when closed, a raw-markdown textarea plus Save/Cancel/Delete when open — the draft persists to `localStorage` on every keystroke (Task 8) so a background refetch or an accidental unmount never drops what's mid-type. */
// fallow-ignore-next-line complexity
const FreeFormBlockRow = ({
  node,
  index,
  line,
  contentHash,
  isOpen,
  onOpen,
  onClose,
  onSave,
  onDelete,
  noteOverrides,
  onOpenNote,
}: {
  readonly node: SteeringViewNode
  readonly index: number
  readonly line: number
  readonly contentHash: string
  readonly isOpen: boolean
  readonly onOpen: () => void
  readonly onClose: () => void
  readonly onSave: (text: string) => Promise<unknown>
  readonly onDelete: () => Promise<unknown>
  readonly noteOverrides: Readonly<Record<number, string>>
  readonly onOpenNote: (node: SteeringViewNode) => void
}) => {
  const [draft, setDraft] = useState<string>(
    () => readDraft(contentHash, line) ?? node.block?.text ?? "",
  )

  if (!isOpen) {
    return (
      <div data-testid={`freeform-block-${index}`}>
        <ProseBlock
          node={node}
          index={index}
          noteOverrides={noteOverrides}
          onOpenNote={onOpenNote}
        />
        <div className="flex justify-end gap-2 border-t border-border px-3 py-2">
          <Button
            variant="ghost"
            data-testid={`freeform-edit-${index}`}
            onClick={() => {
              setDraft(readDraft(contentHash, line) ?? node.block?.text ?? "")
              onOpen()
            }}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            data-testid={`freeform-delete-${index}`}
            onClick={() => {
              // The rejection is already reported via the caller's own
              // `onRefusal` (`FreeFormView`'s delete wrapper) — swallow it
              // here so a refused delete never surfaces as an unhandled
              // promise rejection.
              onDelete().catch(() => {})
            }}
          >
            Delete
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div data-testid={`freeform-block-${index}`} className="p-3">
      <textarea
        data-testid={`freeform-edit-textarea-${index}`}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          writeDraft(contentHash, line, e.target.value)
        }}
        className="min-h-32 w-full resize-none rounded border border-border bg-surface p-2 text-[16px] text-text"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" data-testid={`freeform-cancel-${index}`} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          data-testid={`freeform-save-${index}`}
          onClick={() => {
            // A refused/failed save is already reported by the caller's own
            // `onRefusal` (`FreeFormView`'s save wrapper); this row just
            // needs to leave the draft/textarea open on rejection instead of
            // clearing it, so nothing typed is lost.
            onSave(draft)
              .then(() => {
                clearDraft(contentHash, line)
                onClose()
              })
              .catch(() => {})
          }}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

/** The append row: a persistent last child (no scroll past the document's own length needed to reach it) opening the SAME textarea shape as any other block's edit, anchored at `APPEND_LINE`. */
const AppendRow = ({
  contentHash,
  isOpen,
  onOpen,
  onClose,
  onSave,
}: {
  readonly contentHash: string
  readonly isOpen: boolean
  readonly onOpen: () => void
  readonly onClose: () => void
  readonly onSave: (text: string) => Promise<unknown>
}) => {
  const [draft, setDraft] = useState<string>(() => readDraft(contentHash, APPEND_LINE) ?? "")

  if (!isOpen) {
    return (
      <Button
        variant="ghost"
        data-testid="freeform-append-open"
        onClick={() => {
          setDraft(readDraft(contentHash, APPEND_LINE) ?? "")
          onOpen()
        }}
        className="w-full border-t border-border px-3 py-3 text-left"
      >
        + Add content
      </Button>
    )
  }

  return (
    <div data-testid="freeform-append-row" className="border-t border-border p-3">
      <textarea
        data-testid="freeform-append-textarea"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          writeDraft(contentHash, APPEND_LINE, e.target.value)
        }}
        className="min-h-32 w-full resize-none rounded border border-border bg-surface p-2 text-[16px] text-text"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" data-testid="freeform-append-cancel" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          data-testid="freeform-append-save"
          onClick={() => {
            onSave(draft)
              .then(() => {
                clearDraft(contentHash, APPEND_LINE)
                setDraft("")
                onClose()
              })
              .catch(() => {})
          }}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

const freeFormLoadingMessage = (isLoading: boolean, readError: unknown): string => {
  if (isLoading) return "Loading the file…"
  const refusal = readError !== undefined ? readRefusalFrom(readError) : undefined
  return refusal !== undefined ? messageForReadRefusal(refusal) : "Could not load the file."
}

/**
 * Presentational free-form screen — takes `view`/`contentHash` as props so
 * `FreeForm.stories.tsx` can drive every shape with plain data, mirroring
 * `Plan.tsx#PlanView`'s own split. No findings surface anywhere here: a
 * mode-less file validates nothing (`freeform.ts`'s own `validate` is a
 * constant `[]`), so there is nothing to render for it.
 */
// fallow-ignore-next-line complexity
export const FreeFormView = ({
  view,
  contentHash,
  isLoading,
  readError,
  mode,
  onSave,
  onDelete,
  onDone,
  onSaveNote,
  onRefusal,
}: FreeFormViewProps) => {
  const [openLine, setOpenLine] = useState<number | undefined>(undefined)
  const [noteOverrides, setNoteOverrides] = useState<Record<number, string>>({})
  const [noteSheetAnchor, setNoteSheetAnchor] = useState<SteeringAnchor | undefined>(undefined)

  if (view === undefined) {
    return (
      <Notice tone={isLoading ? "info" : "error"}>
        {freeFormLoadingMessage(isLoading, readError)}
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
          // A refused/failed write reverts the optimistic override — mirrors
          // `Plan.tsx#PlanView`'s identical note-sheet `onSave` handler.
          onSaveNote?.(anchor, text)?.catch((error: unknown) => {
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
      />
    )
  }

  return (
    <div data-testid="freeform-screen" className="flex h-full min-h-0 flex-1 flex-col">
      {mode !== undefined && steeringFormatFor(mode) === undefined && (
        <Notice data-testid="freeform-fallback-notice">
          {`"${mode}" has no screen — editing as plain markdown`}
        </Notice>
      )}
      <div data-testid="freeform-scroll" className="min-h-0 flex-1 overflow-auto">
        <CardList>
          {view.nodes.map((node, index) => {
            const line = lineOf(node, index)
            return (
              <FreeFormBlockRow
                key={line}
                node={node}
                index={index}
                line={line}
                contentHash={contentHash}
                isOpen={openLine === line}
                onOpen={() => setOpenLine(line)}
                onClose={() => setOpenLine(undefined)}
                onSave={(text) => {
                  if (onSave === undefined) return Promise.resolve()
                  return onSave(line, text).catch((error: unknown) => {
                    onRefusal?.(error, () => onSave(line, text))
                    throw error
                  })
                }}
                onDelete={() => {
                  if (onDelete === undefined) return Promise.resolve()
                  return onDelete(line).catch((error: unknown) => {
                    onRefusal?.(error, () => onDelete(line))
                    throw error
                  })
                }}
                noteOverrides={noteOverrides}
                onOpenNote={(n) => setNoteSheetAnchor(n.anchor)}
              />
            )
          })}
        </CardList>
      </div>
      {/*
       * OUTSIDE the scroll container (`shrink-0`, matching the `plan-done-row`
       * footer right below it) — Requirement B's "lands new content at the
       * end without scrolling the whole document first": a 200-line file
       * would otherwise bury this affordance at the bottom of a long scroll
       * region, exactly the dominant-capture-case friction it exists to
       * avoid.
       */}
      <div className="shrink-0">
        <AppendRow
          contentHash={contentHash}
          isOpen={openLine === APPEND_LINE}
          onOpen={() => setOpenLine(APPEND_LINE)}
          onClose={() => setOpenLine(undefined)}
          onSave={(text) => {
            if (onSave === undefined) return Promise.resolve()
            return onSave(APPEND_LINE, text).catch((error: unknown) => {
              onRefusal?.(error, () => onSave(APPEND_LINE, text))
              throw error
            })
          }}
        />
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

const casTokensFor = (
  data: { readonly headSha: string; readonly contentHash: string } | undefined,
  /**
   * Task 6's own client half: the LAST `contentHash` a write of ours actually
   * resolved with (post-format), when we have one — overrides whatever the
   * query cache still carries, so a second Save fired before the
   * `onSettled` invalidate/refetch lands sends the token the server itself
   * just handed back, not the pre-write one. `undefined` until this
   * component's own first successful write; a stale/wrong override then only
   * matters if a genuine concurrent edit landed underneath us, in which case
   * `stale-token`/`moved:"content-hash"` refusing is the CORRECT outcome
   * `withStaleShaRetry` deliberately never papers over.
   */
  contentHashOverride: string | undefined,
): CasTokens | undefined =>
  data === undefined
    ? undefined
    : {
        expectedHeadSha: data.headSha,
        expectedContentHash: contentHashOverride ?? data.contentHash,
      }

/** Every mutation `FreeForm` wires up — mirrors `Plan.tsx#usePlanMutations`'s identical shape, using `setValue` (`SteeringFormat.apply`) for every block write since free-form has no note-shaped `annotate` call here: an edit/delete/append is a whole-block replace, not a footnote attach. */
const useFreeFormMutations = (
  filePath: string,
  mode: string | undefined,
  data: { readonly headSha: string; readonly contentHash: string } | undefined,
  /** Task 6/5's own client-side sinks: called on every successful write with the post-format `contentHash` (token swap) and, when the configured `ui.format` command failed, the `formatNotice` naming it — never on a refusal, which the caller's own `.catch` handles separately. */
  onWriteSuccess: (contentHash: string, formatNotice?: FormatNotice) => void,
) => {
  // A `useRef`, NOT `useState` — `onSave`/`onSaveNote` below get handed to
  // `useRefusal`'s own "Try again" as a bare closure
  // (`onRefusal?.(error, () => onSave(line, text))`, in `FreeFormView`),
  // stored in THAT hook's own state and invoked an arbitrary number of
  // renders later. A `useState` value read inside `onSave`/`onSaveNote`
  // would stay whatever `contentHashOverride` was AT THE RENDER the retry
  // thunk was captured on — frozen, never seeing a LATER
  // `setContentHashOverride` this same hook call performs before the retry
  // fires — since a plain closure doesn't re-run when state changes; only a
  // NEW render's closure would see the new value, and nothing re-creates the
  // stored retry thunk on a state change alone. Never rendered anywhere
  // (nothing displays it), so there is no re-render to trigger either — a
  // ref is both correct and simpler here.
  const contentHashOverrideRef = useRef<string | undefined>(undefined)
  const setContentHashOverride = (value: string | undefined): void => {
    contentHashOverrideRef.current = value
  }
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
    setContentHashOverride(undefined)
    return { expectedHeadSha: fresh.headSha, expectedContentHash: fresh.contentHash }
  }

  /** Every successful `setValue`/`writeNote` result funnels through here: swaps the local token override for the post-format hash the server just returned, and surfaces a format-command failure (if any) to the caller. */
  const handleWriteResult = (result: {
    readonly contentHash: string
    readonly formatNotice?: FormatNotice
  }): void => {
    setContentHashOverride(result.contentHash)
    onWriteSuccess(result.contentHash, result.formatNotice)
  }

  /**
   * The other half of Task 6's own token bookkeeping: a `stale-token`
   * refusal — `moved: "sha"` OR `"content-hash"` — means our own override no
   * longer describes reality (a genuine concurrent edit, most likely for
   * `"content-hash"`), so it's dropped rather than reused forever. Without
   * this, `withStaleShaRetry` only clears/refreshes on a `"sha"` move (via
   * `refetchTokens`); a `"content-hash"` refusal left the override standing,
   * wedging every later write behind the SAME stale token — including the
   * refusal banner's own "Try again", which re-enters this exact path — until
   * a full page reload. Falling back to `data.contentHash` (whatever the
   * `onSettled` invalidate's own refetch already landed, or will shortly) is
   * always at least as fresh as the override it replaces.
   */
  const dropStaleOverrideOn = (error: unknown): void => {
    if (writeRefusalFrom(error)?.reason === "stale-token") setContentHashOverride(undefined)
  }

  const onSave = (line: number, text: string): Promise<unknown> => {
    const tokens = casTokensFor(data, contentHashOverrideRef.current)
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
      dropStaleOverrideOn(error)
      throw error
    })
  }

  const onDelete = (line: number): Promise<unknown> => onSave(line, "")

  const onSaveNote = (anchor: SteeringAnchor, text: string): Promise<unknown> => {
    const tokens = casTokensFor(data, contentHashOverrideRef.current)
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
      dropStaleOverrideOn(error)
      throw error
    })
  }

  const onDone = (): Promise<unknown> => done.mutateAsync({})

  return { onSave, onDelete, onSaveNote, onDone, isDone: done.isSuccess }
}

const freeFormViewDataProps = (
  data: { readonly view?: SteeringView; readonly contentHash?: string } | undefined,
) => ({ view: data?.view, contentHash: data?.contentHash ?? "" })

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
  const { onSave, onDelete, onSaveNote, onDone, isDone } = useFreeFormMutations(
    filePath,
    mode,
    query.data,
    (_contentHash, notice) => setFormatNotice(notice),
  )

  const onSaveTracked = (line: number, text: string): Promise<unknown> =>
    trackSave(onSave(line, text))
  const onDeleteTracked = (line: number): Promise<unknown> => trackSave(onDelete(line))
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
          isLoading={query.isLoading}
          readError={query.error}
          mode={mode}
          onSave={onSaveTracked}
          onDelete={onDeleteTracked}
          onDone={onDoneWithRefusal}
          onSaveNote={onSaveNoteTracked}
          onRefusal={showRefusal}
        />
      )}
    </>
  )
}
