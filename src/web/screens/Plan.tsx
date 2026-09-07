import { useEffect, useState } from "react"
import type { SteeringAnchor, SteeringView, SteeringViewNode } from "../../SteeringFormat.js"
import { Card, CardList } from "../Card.js"
import { Deck } from "../Deck.js"
import { NoteSheet } from "../NoteSheet.js"
import { trpc } from "../api.js"
import { useScrollRestoration } from "../useScrollRestoration.js"
import { Question } from "./Question.js"

/**
 * A browser-safe, non-cryptographic hash of steering-file content — purely a
 * UI-state cache key (the "read the plan" confirmation below), never a
 * security boundary, so FNV-1a over `charCodeAt` is plenty: no `SubtleCrypto`
 * round-trip (which is async, and `contentHashOf`'s `node:crypto` isn't
 * importable into browser code at all).
 */
const hashContent = (content: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}

const readPlanStorageKey = (hash: string): string => `gtd:plan-read:${hash}`

/**
 * "Read the plan" confirmation state, keyed on `content`'s own hash so a
 * rewrite (a different hash) always starts unconfirmed again — persisted in
 * `localStorage` so it survives a reload of the same, unchanged file.
 */
const usePlanReadConfirmation = (content: string) => {
  const hash = hashContent(content)
  const [confirmed, setConfirmed] = useState(
    () => localStorage.getItem(readPlanStorageKey(hash)) === "true",
  )

  useEffect(() => {
    setConfirmed(localStorage.getItem(readPlanStorageKey(hash)) === "true")
  }, [hash])

  const confirm = () => {
    localStorage.setItem(readPlanStorageKey(hash), "true")
    setConfirmed(true)
  }

  return { confirmed, confirm }
}

/** A `qa`-view question node sets `status` (`"open"`/`"answered"`); a prose-only document's `view` has no such nodes at all — every one of its `view.nodes` is instead a `paragraph`-anchored node (`OpenQuestions.ts#paragraphNodesOf`). */
const isQuestionNode = (node: SteeringViewNode): boolean => node.status !== undefined

const QuestionCard = ({
  node,
  onOpen,
}: {
  readonly node: SteeringViewNode
  readonly onOpen: () => void
}) => (
  <Card
    testId={`question-card-${node.anchor.kind === "question" ? node.anchor.index : 0}`}
    onOpen={onOpen}
  >
    <div style={{ fontWeight: 600 }}>{node.title}</div>
    {node.detail !== undefined && node.detail.length > 0 && (
      <div style={{ fontSize: 12, opacity: 0.7 }}>{node.detail}</div>
    )}
  </Card>
)

/** One paragraph plus its inline note (if any) and its note seam — `line` is the paragraph's real, server-computed anchor line when it has one (every prose-only node does), falling back to array `index` only for a malformed/non-paragraph node so the row still renders and keys uniquely. Exercised by `Plan.stories.tsx`'s `play()` tests; see `Fleet.tsx#FleetView`'s note on why fallow's static CRAP estimate scores it as untested regardless. */
// fallow-ignore-next-line complexity
const ProseParagraph = ({
  node,
  index,
  noteOverrides,
  onOpenNote,
}: {
  readonly node: SteeringViewNode
  readonly index: number
  readonly noteOverrides: Readonly<Record<number, string>>
  readonly onOpenNote: (node: SteeringViewNode) => void
}) => {
  const line = node.anchor.kind === "paragraph" ? node.anchor.line : index
  const noteText = noteOverrides[line] ?? node.note
  return (
    <div>
      <p style={{ padding: "8px 12px", margin: 0 }}>{node.title}</p>
      {noteText !== undefined && noteText.length > 0 && (
        <div
          data-testid={`paragraph-note-${index}`}
          style={{ fontSize: 12, opacity: 0.7, padding: "0 12px 8px" }}
        >
          {noteText}
        </div>
      )}
      <button
        type="button"
        data-testid={`note-seam-${index}`}
        onClick={() => onOpenNote(node)}
        style={{
          display: "block",
          width: "100%",
          height: 6,
          border: "none",
          background: "none",
          padding: 0,
        }}
      />
    </div>
  )
}

/** Prose-only rendering: one `ProseParagraph` per `view.nodes` entry (each carrying a real, server-computed `paragraph` anchor — `OpenQuestions.ts#paragraphNodesOf`). A paragraph already carrying a note (`node.note`, or a locally-saved override) shows it inline and offers editing via the same seam, never a second note. */
const ProseParagraphs = ({
  nodes,
  noteOverrides,
  onOpenNote,
}: {
  readonly nodes: readonly SteeringViewNode[]
  readonly noteOverrides: Readonly<Record<number, string>>
  readonly onOpenNote: (node: SteeringViewNode) => void
}) => (
  <div data-testid="prose-paragraphs">
    {nodes.map((node, index) => (
      <ProseParagraph
        key={node.anchor.kind === "paragraph" ? node.anchor.line : index}
        node={node}
        index={index}
        noteOverrides={noteOverrides}
        onOpenNote={onOpenNote}
      />
    ))}
  </div>
)

export interface PlanViewProps {
  readonly view: SteeringView | undefined
  readonly content: string
  readonly isLoading: boolean
  /** Called with a saved paragraph note's `anchor`/`text` — the real `Plan` container wires this to an actual `writeNote` mutation. Local optimistic state (`noteOverrides`) still updates immediately either way. Absent in `Plan.stories.tsx`'s pure-data stories. */
  readonly onSaveNote?: (anchor: SteeringAnchor, text: string) => void
}

/** One of the two question groups (open / already-answered) — empty groups render nothing, never an empty heading. */
const QuestionSection = ({
  title,
  nodes,
  allNodes,
  onOpen,
}: {
  readonly title: string
  readonly nodes: readonly SteeringViewNode[]
  readonly allNodes: readonly SteeringViewNode[]
  readonly onOpen: (index: number) => void
}) => {
  if (nodes.length === 0) return null
  return (
    <section>
      <h2 style={{ fontSize: 13, opacity: 0.7, margin: "12px" }}>{title}</h2>
      {nodes.map((node) => (
        <QuestionCard
          key={allNodes.indexOf(node)}
          node={node}
          onOpen={() => onOpen(allNodes.indexOf(node))}
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
    return (
      <ProseParagraphs nodes={view.nodes} noteOverrides={noteOverrides} onOpenNote={onOpenNote} />
    )
  }
  const openNodes = questionNodes.filter((node) => node.status === "open")
  const answeredNodes = questionNodes.filter((node) => node.status === "answered")
  return (
    <>
      <QuestionSection
        title="Open Questions"
        nodes={openNodes}
        allNodes={questionNodes}
        onOpen={onOpenQuestion}
      />
      <QuestionSection
        title="Already answered"
        nodes={answeredNodes}
        allNodes={questionNodes}
        onOpen={onOpenQuestion}
      />
    </>
  )
}

/**
 * Presentational plan-and-answer screen — takes its `view`/`content` as
 * props (mirroring `FleetView`'s split) so `Plan.stories.tsx` can drive every
 * shape with plain data, no mocked tRPC transport required. Never switches on
 * a mode name: whether this renders questions or plain prose is read
 * entirely off `view.nodes`' own shape. Exercised by `Plan.stories.tsx`'s
 * `play()` tests; see `Fleet.tsx#FleetView`'s note on why fallow's static
 * CRAP estimate scores it as untested regardless.
 */
// fallow-ignore-next-line complexity
export const PlanView = ({ view, content, isLoading, onSaveNote }: PlanViewProps) => {
  const { confirmed, confirm } = usePlanReadConfirmation(content)
  const [deckIndex, setDeckIndex] = useState<number | undefined>(undefined)
  const [noteOverrides, setNoteOverrides] = useState<Record<number, string>>({})
  const [noteSheetAnchor, setNoteSheetAnchor] = useState<SteeringAnchor | undefined>(undefined)
  const scroll = useScrollRestoration()

  if (view === undefined) {
    return (
      <div style={{ padding: 16 }}>
        {isLoading ? "Loading the plan…" : "Could not load the plan."}
      </div>
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
          onSaveNote?.(anchor, text)
        }}
        onDismiss={() => setNoteSheetAnchor(undefined)}
      />
    )
  }

  if (deckIndex !== undefined) {
    return (
      <Deck
        items={view.nodes.filter(isQuestionNode)}
        index={deckIndex}
        onIndexChange={setDeckIndex}
        onExit={() => {
          setDeckIndex(undefined)
          scroll.restore()
        }}
        renderItem={(node, index) => <Question key={index} node={node} />}
      />
    )
  }

  return (
    <div data-testid="plan-screen" style={{ maxWidth: 390, margin: "0 auto" }}>
      <CardList>
        <Card testId="read-plan-row" onOpen={confirm}>
          Read the plan{confirmed ? " ✓" : ""}
        </Card>
        <PlanBody
          view={view}
          noteOverrides={noteOverrides}
          onOpenQuestion={(index) => {
            scroll.capture()
            setDeckIndex(index)
          }}
          onOpenNote={(node) => setNoteSheetAnchor(node.anchor)}
        />
      </CardList>
    </div>
  )
}

export interface PlanProps {
  readonly worktreePath: string
  /** Path to the plan/prose steering file, relative to `worktreePath`. */
  readonly filePath: string
  readonly mode: string
}

/**
 * The real plan screen: fetches content/`view`/tokens through
 * `readSteeringFile` (never a bare `content` prop with no way to have
 * actually been fetched — see `Review.tsx#Review`'s identical split), and
 * write-throughs a saved paragraph note via `writeNote`'s compare-and-swap
 * using the SAME tokens that fetch returned. Not yet imported by `App.tsx` —
 * routing between screens is a later package's task, not this one's.
 */
export const Plan = ({ worktreePath, filePath, mode }: PlanProps) => {
  const utils = trpc.useUtils()
  const query = trpc.readSteeringFile.useQuery({ worktreePath, filePath, mode })
  const writeNote = trpc.writeNote.useMutation({
    onSettled: () => utils.readSteeringFile.invalidate({ worktreePath, filePath, mode }),
  })

  const onSaveNote = (anchor: SteeringAnchor, text: string) => {
    const data = query.data
    if (data === undefined) return
    writeNote.mutate({
      worktreePath,
      filePath,
      expectedHeadSha: data.headSha,
      expectedContentHash: data.contentHash,
      mode,
      anchor,
      text,
    })
  }

  return (
    <PlanView
      view={query.data?.view}
      content={query.data?.content ?? ""}
      isLoading={query.isLoading}
      onSaveNote={onSaveNote}
    />
  )
}
