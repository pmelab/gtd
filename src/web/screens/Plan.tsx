import { useEffect, useState } from "react"
import type { SteeringView, SteeringViewNode } from "../../SteeringFormat.js"
import { Card, CardList } from "../Card.js"
import { Deck } from "../Deck.js"
import { trpc } from "../api.js"
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

/** A `qa`-view question node sets `status` (`"open"`/`"answered"`); a prose-only document's `view` has no such nodes at all. */
const isQuestionNode = (node: SteeringViewNode): boolean => node.status !== undefined

/** Splits raw markdown `content` into prose paragraphs on blank lines — used only for the prose-only (no question-shaped nodes) rendering path, since a `qa`-view with no sections carries no paragraph nodes of its own for the client to read. */
const paragraphsOf = (content: string): readonly string[] =>
  content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)

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

/** Prose-only rendering: one paragraph plus a thin full-width note seam below it — the seam's actual wiring to a note sheet is a different task/file (`NoteSheet.tsx`, not in this component's scope). */
const ProseParagraphs = ({ content }: { readonly content: string }) => (
  <div data-testid="prose-paragraphs">
    {paragraphsOf(content).map((paragraph, index) => (
      <div key={index}>
        <p style={{ padding: "8px 12px", margin: 0 }}>{paragraph}</p>
        <button
          type="button"
          data-testid={`note-seam-${index}`}
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
    ))}
  </div>
)

export interface PlanViewProps {
  readonly view: SteeringView | undefined
  readonly content: string
  readonly isLoading: boolean
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
  content,
  onOpenQuestion,
}: {
  readonly view: SteeringView
  readonly content: string
  readonly onOpenQuestion: (index: number) => void
}) => {
  const questionNodes = view.nodes.filter(isQuestionNode)
  if (questionNodes.length === 0) return <ProseParagraphs content={content} />
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
export const PlanView = ({ view, content, isLoading }: PlanViewProps) => {
  const { confirmed, confirm } = usePlanReadConfirmation(content)
  const [deckIndex, setDeckIndex] = useState<number | undefined>(undefined)

  if (view === undefined) {
    return (
      <div style={{ padding: 16 }}>
        {isLoading ? "Loading the plan…" : "Could not load the plan."}
      </div>
    )
  }

  if (deckIndex !== undefined) {
    return (
      <Deck
        items={view.nodes.filter(isQuestionNode)}
        index={deckIndex}
        onIndexChange={setDeckIndex}
        onExit={() => setDeckIndex(undefined)}
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
        <PlanBody view={view} content={content} onOpenQuestion={setDeckIndex} />
      </CardList>
    </div>
  )
}

export interface PlanProps {
  readonly content: string
  readonly mode: string
}

/** The real plan screen: wires `PlanView` to the actual `view` tRPC query for a given `content`/`mode` pair. Not yet imported by `App.tsx` — routing between screens is a later package's task, not this one's. */
// fallow-ignore-next-line unused-export
export const Plan = ({ content, mode }: PlanProps) => {
  const query = trpc.view.useQuery({ content, mode })
  return <PlanView view={query.data?.view} content={content} isLoading={query.isLoading} />
}
