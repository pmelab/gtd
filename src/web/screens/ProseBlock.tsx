import type { ReactElement, ReactNode } from "react"
import type { BlockListItem, SteeringViewNode } from "../../steering/index.js"
import { Button } from "../Button.js"

/** A markdown inline link — `[label](url)` — the one inline construct Requirement A names ("headings, paragraphs, lists, code blocks, links") that survives into a node's `title`/`block.text` verbatim (`Blocks.ts#blockTitle`/`sourceText` strip footnote markers only, never link syntax). */
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g

/** One piece of `splitOnLinks`'s own output — plain text, or a matched link's own label/href. */
type TextPart = { readonly text: string } | { readonly label: string; readonly href: string }

/** Splits `text` on every `[label](url)` occurrence — the pure matching half of `InlineText`, kept apart from JSX so neither half carries the other's own branching. */
const splitOnLinks = (text: string): readonly TextPart[] => {
  const parts: TextPart[] = []
  let lastIndex = 0
  LINK_RE.lastIndex = 0
  for (let match = LINK_RE.exec(text); match !== null; match = LINK_RE.exec(text)) {
    if (match.index > lastIndex) parts.push({ text: text.slice(lastIndex, match.index) })
    parts.push({ label: match[1]!, href: match[2]! })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex) })
  return parts
}

/**
 * Renders `text` with every `[label](url)` occurrence as a real `<a>`,
 * everything else as a plain string child — never wrapped in an extra
 * element: `HeadingBlock`'s own `heading.tagName === "H2"` assertion (and
 * every other caller's own text-content check) must still resolve to the
 * SAME element this returns children into, not a synthetic wrapper one
 * level deeper.
 */
const InlineText = ({ text }: { readonly text: string }): ReactNode =>
  splitOnLinks(text).map((part, index) =>
    "href" in part ? (
      <a key={index} href={part.href} target="_blank" rel="noreferrer" className="underline">
        {part.label}
      </a>
    ) : (
      part.text
    ),
  )

/** The heading tag a `block.heading`'s own `depth` renders as — three buckets covering all six markdown levels, never a literal `h1`..`h6` (this screen's own `h2` already labels "Open Questions"/"Already answered"). */
const headingTagFor = (depth: number): "h2" | "h3" | "h4" => {
  if (depth <= 2) return "h2"
  if (depth === 3) return "h3"
  return "h4"
}

/** One `list` block's own items, recursively — a nested `items` array renders as a nested `ul`/`ol` inside its parent's `li`. */
const BlockList = ({
  items,
  ordered,
}: {
  readonly items: readonly BlockListItem[]
  readonly ordered: boolean
}) => {
  const ListTag = ordered ? "ol" : "ul"
  return (
    <ListTag className="m-0 pl-5">
      {items.map((item, index) => (
        <li key={index}>
          {item.checked !== undefined && (
            <input type="checkbox" checked={item.checked} readOnly className="mr-2 align-middle" />
          )}
          <InlineText text={item.text} />
          {item.items !== undefined && <BlockList items={item.items} ordered={ordered} />}
        </li>
      ))}
    </ListTag>
  )
}

/** A `heading` block's own rendering — its own component so `BlockBody`'s switch stays a plain dispatch, with every field's fallback living next to the field it defaults. */
const HeadingBlock = ({ node }: { readonly node: SteeringViewNode }) => {
  const HeadingTag = headingTagFor(node.block?.depth ?? 2)
  return (
    <HeadingTag className="m-0 px-3 py-2 font-semibold">
      <InlineText text={node.title} />
    </HeadingTag>
  )
}

/** A `list` block's own rendering — see `HeadingBlock`'s doc comment for why this is split out. */
const ListBlock = ({ node }: { readonly node: SteeringViewNode }) => (
  <div className="px-3 py-2">
    <BlockList items={node.block?.items ?? []} ordered={node.block?.ordered === true} />
  </div>
)

/** A `code` block's own rendering — see `HeadingBlock`'s doc comment for why this is split out. */
const CodeBlock = ({ node }: { readonly node: SteeringViewNode }) => (
  <pre className="m-0 overflow-auto bg-muted px-3 py-2">
    <code>{node.block?.text ?? ""}</code>
  </pre>
)

/** A `blockquote` block's own rendering — see `HeadingBlock`'s doc comment for why this is split out. */
const BlockquoteBlock = ({ node }: { readonly node: SteeringViewNode }) => (
  <blockquote className="m-0 border-l-2 border-border px-3 py-2 italic text-muted">
    <InlineText text={node.block?.text ?? node.title} />
  </blockquote>
)

/** The plain `p` fallback — `block` absent, or a `kind` this doesn't (yet) render structure for — exactly the fallback Task 4 requires so a client that ignores `block` still renders `title`. */
const ParagraphBlock = ({ node }: { readonly node: SteeringViewNode }) => (
  <p className="m-0 px-3 py-2">
    <InlineText text={node.title} />
  </p>
)

/** One renderer per `block.kind` this switches on — a lookup table, not a `switch`, so `BlockBody` itself stays a single dispatch with no per-case branch of its own. */
const BLOCK_RENDERERS: Record<
  string,
  (props: { readonly node: SteeringViewNode }) => ReactElement
> = {
  heading: HeadingBlock,
  list: ListBlock,
  code: CodeBlock,
  blockquote: BlockquoteBlock,
}

/** The structural element `block` renders as — see `BLOCK_RENDERERS`/`ParagraphBlock` for the per-kind renderers and the fallback. */
const BlockBody = ({ node }: { readonly node: SteeringViewNode }) => {
  const Renderer = BLOCK_RENDERERS[node.block?.kind ?? ""] ?? ParagraphBlock
  return <Renderer node={node} />
}

/**
 * One block plus its inline note (if any) and its note seam — `line` is the
 * block's real, server-computed anchor line when it has one (every
 * prose-only node does), falling back to array `index` only for a malformed
 * node so the row still renders and keys uniquely. A fenced CODE block gets
 * neither the seam nor the inline note row (Task 3's own reason: a marker on
 * its anchor line would land in the opening fence and corrupt it) — every
 * other kind gets both.
 */
// fallow-ignore-next-line complexity
export const ProseBlock = ({
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
  const hasNote = noteText !== undefined && noteText.length > 0
  const isCode = node.block?.kind === "code"
  return (
    <div>
      <BlockBody node={node} />
      {!isCode && hasNote && (
        <div data-testid={`paragraph-note-${index}`} className="px-3 pb-2 text-small text-muted">
          {noteText}
        </div>
      )}
      {/*
       * A real, visible affordance below the block — full-width and thin
       * relative to the block's own text (a single small line, not a
       * card), but never a 0-visible-pixels strip: a 1px top border draws
       * the seam itself, the label makes its purpose legible, and a 44px
       * minimum height (Apple's/Android's own minimum recommended touch
       * target) makes it reliably tappable on a phone.
       */}
      {!isCode && (
        <Button
          variant="ghost"
          data-testid={`note-seam-${index}`}
          onClick={() => onOpenNote(node)}
          className="w-full rounded-none border-t border-border px-3 text-left text-small text-muted"
        >
          {hasNote ? "Edit note" : "+ Add note"}
        </Button>
      )}
    </div>
  )
}

/** Prose-only rendering: one `ProseBlock` per `view.nodes` entry (each carrying a real, server-computed `paragraph` anchor — `OpenQuestions.ts#blockNodesOf`). A block already carrying a note (`node.note`, or a locally-saved override) shows it inline and offers editing via the same seam, never a second note. */
export const ProseBlocks = ({
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
      <ProseBlock
        key={node.anchor.kind === "paragraph" ? node.anchor.line : index}
        node={node}
        index={index}
        noteOverrides={noteOverrides}
        onOpenNote={onOpenNote}
      />
    ))}
  </div>
)
