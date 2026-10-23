import { useState } from "react"
import { steeringFormatFor } from "../../steering/index.js"
import type { SteeringAnchor, SteeringView, SteeringViewNode } from "../../steering/index.js"
import { Button } from "../Button.js"
import { FormatNoticeBanner, type FormatNotice } from "../FormatNotice.js"
import { Notice } from "../Notice.js"
import { NoteSheet } from "../NoteSheet.js"
import { messageForReadRefusal, SaveIndicator, useSaveIndicatorProps } from "../Refusal.js"
import { readRefusalFrom, trpc } from "../api.js"
import type { CasTokens } from "../staleRetry.js"
import { cellKey, useWriteStore, WriteStoreProvider } from "../writeStore.js"
import { ProseBlocks } from "./ProseBlock.js"

type TokenGuardedWrite = (tokens: CasTokens) => Promise<unknown>

const MODE = "findings"
const NOISE_GROUP = "Dropped as noise"

/** One finding's decision: its box and the guidance under it. */
interface Decision {
  readonly fix: boolean
  readonly guidance: string
}

const decisionOf = (node: SteeringViewNode): Decision => ({
  fix: node.checked === true,
  guidance: node.note ?? "",
})

interface FindingsViewProps {
  readonly view: SteeringView | undefined
  readonly filePath: string
  /** The file as read, for the same validator the landing runs. */
  readonly content?: string | undefined
  readonly isLoading: boolean
  readonly readError?: unknown
  readonly onDecide?: (
    anchor: SteeringAnchor,
    opts: { readonly checked: boolean; readonly text?: string },
  ) => TokenGuardedWrite
  readonly onDone?: () => Promise<unknown>
  readonly busy?: boolean | undefined
}

// fallow-ignore-next-line complexity
const FindingRow = ({
  node,
  index,
  decision,
  onToggle,
  onEditGuidance,
}: {
  readonly node: SteeringViewNode
  readonly index: number
  readonly decision: Decision
  readonly onToggle: (fix: boolean) => void
  readonly onEditGuidance: () => void
}) => {
  const id = `finding-fix-${index}`
  return (
    <li
      data-testid={`finding-${index}`}
      className={`border-b border-divider px-3 py-3 ${decision.fix ? "border-l-4 border-l-accent bg-surface" : ""}`}
    >
      <label htmlFor={id} className="flex min-h-11 items-start gap-3">
        <input
          id={id}
          type="checkbox"
          data-testid={`finding-checkbox-${index}`}
          className="mt-1 size-5 shrink-0"
          checked={decision.fix}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{node.title}</span>
          <span className="block text-small text-muted">{decision.fix ? "Fix" : "Drop"}</span>
        </span>
      </label>
      {node.body !== undefined && node.body.length > 0 && (
        <div className="pl-8">
          <ProseBlocks nodes={node.body} noteOverrides={{}} onOpenNote={() => {}} readOnly />
        </div>
      )}
      {decision.fix && (
        <div className="pl-8">
          <Button
            variant="ghost"
            data-testid={`finding-guidance-${index}`}
            onClick={onEditGuidance}
            aria-label={
              decision.guidance === "" ? undefined : `Edit guidance: ${decision.guidance}`
            }
            className="w-full px-0 text-left text-small font-normal text-muted"
          >
            {decision.guidance !== "" ? decision.guidance : "Add guidance for the fixer (optional)"}
          </Button>
        </div>
      )}
    </li>
  )
}

const Group = ({
  title,
  entries,
  render,
}: {
  readonly title: string
  readonly entries: readonly { node: SteeringViewNode; index: number }[]
  readonly render: (node: SteeringViewNode, index: number) => React.ReactNode
}) =>
  entries.length === 0 ? null : (
    <section aria-label={title}>
      <h2 className="m-0 px-3 pt-4 pb-1 text-small font-semibold text-muted uppercase">{title}</h2>
      <ul className="m-0 list-none p-0">{entries.map(({ node, index }) => render(node, index))}</ul>
    </section>
  )

/** The finding gate: tick a finding to fix it, with optional guidance; unticked ones are dropped. */
// fallow-ignore-next-line complexity
const FindingsView = ({
  view,
  filePath,
  content,
  isLoading,
  readError,
  onDecide,
  onDone,
  busy,
}: FindingsViewProps) => {
  const overlay = useWriteStore((s) => s.overlay)
  const save = useWriteStore((s) => s.save)
  const [editing, setEditing] = useState<number | undefined>(undefined)

  if (view === undefined) {
    const refusal = readError === undefined ? undefined : readRefusalFrom(readError)
    return (
      <Notice tone={isLoading ? "info" : "error"}>
        {isLoading
          ? "Loading the findings…"
          : refusal !== undefined
            ? messageForReadRefusal(refusal)
            : "Could not load the findings."}
      </Notice>
    )
  }

  const decisionAt = (node: SteeringViewNode): Decision =>
    (overlay[cellKey(filePath, node.anchor, "decision")]?.value as Decision | undefined) ??
    decisionOf(node)

  const decide = (node: SteeringViewNode, next: Decision): void => {
    save({
      cell: cellKey(filePath, node.anchor, "decision"),
      optimistic: next,
      write: onDecide?.(
        node.anchor,
        next.fix ? { checked: true, text: next.guidance } : { checked: false },
      ),
    }).catch(() => {})
  }

  const entries = view.nodes.map((node, index) => ({ node, index }))
  const problems = content === undefined ? [] : steeringFormatFor(MODE)!.validate(content)
  const editingNode = editing === undefined ? undefined : view.nodes[editing]
  const fixing = view.nodes.filter((n) => decisionAt(n).fix).length

  const row = (node: SteeringViewNode, index: number) => {
    const decision = decisionAt(node)
    return (
      <FindingRow
        key={index}
        node={node}
        index={index}
        decision={decision}
        // Unticking drops the guidance too: guidance under an unticked box is refused.
        onToggle={(fix) => decide(node, { fix, guidance: fix ? decision.guidance : "" })}
        onEditGuidance={() => setEditing(index)}
      />
    )
  }

  return (
    <>
      <div data-testid="findings-screen" className="flex h-full min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <p className="m-0 px-3 pt-3 text-small text-muted">
            Tick a finding to have it fixed; an unticked one is dropped. Anything bigger belongs in
            the final review.
          </p>
          {view.nodes.length === 0 && (
            <Notice data-testid="findings-empty">No findings to decide on.</Notice>
          )}
          <Group
            title="Open"
            entries={entries.filter(({ node }) => node.group !== NOISE_GROUP)}
            render={row}
          />
          <Group
            title={NOISE_GROUP}
            entries={entries.filter(({ node }) => node.group === NOISE_GROUP)}
            render={row}
          />
          {problems.length > 0 && (
            <Notice tone="error" data-testid="findings-problems" role="status">
              {problems.map((p) => p.message).join(" ")}
            </Notice>
          )}
        </div>
        {onDone !== undefined && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-3">
            <span data-testid="findings-summary" className="text-small text-muted">
              {`${fixing} to fix, ${view.nodes.length - fixing} to drop`}
            </span>
            <Button
              variant="primary"
              data-testid="findings-done"
              onClick={() => {
                save({
                  cell: cellKey(filePath, undefined, "done"),
                  optimistic: true,
                  mutate: onDone,
                }).catch(() => {})
              }}
              disabled={busy === true || problems.length > 0}
            >
              Done
            </Button>
          </div>
        )}
      </div>
      {editingNode !== undefined && (
        <NoteSheet
          anchor={editingNode.anchor}
          title="Guidance for the fixer"
          label="Guidance"
          note={decisionAt(editingNode).guidance}
          onSave={(_anchor, text) => {
            setEditing(undefined)
            decide(editingNode, { fix: true, guidance: text.trim() })
          }}
          onDismiss={() => setEditing(undefined)}
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

const FindingsInner = ({
  filePath,
  data,
  isLoading,
  error,
}: {
  readonly filePath: string
  readonly data: { readonly view?: SteeringView; readonly content?: string } | undefined
  readonly isLoading: boolean
  readonly error: unknown
}) => {
  const indicatorProps = useSaveIndicatorProps()
  const pending = useWriteStore((s) => s.pendingCount)
  const [formatNotice, setFormatNotice] = useState<FormatNotice | undefined>(undefined)
  const utils = trpc.useUtils()
  const setValue = trpc.setValue.useMutation({
    onSettled: () => utils.readSteeringFile.invalidate({ filePath, mode: MODE }),
  })
  const done = trpc.done.useMutation()

  const onDecide =
    (anchor: SteeringAnchor, opts: { readonly checked: boolean; readonly text?: string }) =>
    (cas: CasTokens): Promise<unknown> =>
      setValue.mutateAsync({ filePath, ...cas, mode: MODE, anchor, ...opts }).then((result) => {
        setFormatNotice(result.formatNotice)
        return result
      })

  return (
    <>
      <SaveIndicator {...indicatorProps} />
      <FormatNoticeBanner notice={formatNotice} onDismiss={() => setFormatNotice(undefined)} />
      {done.isSuccess ? (
        <HandedBackPanel />
      ) : (
        <FindingsView
          view={data?.view}
          content={data?.content}
          filePath={filePath}
          isLoading={isLoading}
          readError={error}
          onDecide={onDecide}
          onDone={() => done.mutateAsync({})}
          busy={pending > 0}
        />
      )}
    </>
  )
}

/** The finding gate's screen: reads `.gtd/QUALITY.md` as the `findings` format and writes each decision back. */
export const Findings = ({ filePath }: { readonly filePath: string }) => {
  const utils = trpc.useUtils()
  const query = trpc.readSteeringFile.useQuery({ filePath, mode: MODE })
  const refetchTokens = async (): Promise<CasTokens> => {
    const fresh = await utils.readSteeringFile.fetch({ filePath, mode: MODE })
    return { expectedHeadSha: fresh.headSha, expectedContentHash: fresh.contentHash }
  }
  return (
    <WriteStoreProvider tokens={query.data} refetchTokens={refetchTokens}>
      <FindingsInner
        filePath={filePath}
        data={query.data}
        isLoading={query.isLoading}
        error={query.error}
      />
    </WriteStoreProvider>
  )
}
