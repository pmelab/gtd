import type { ReactElement, ReactNode } from "react"
import type { BlockListItem, SteeringViewNode } from "../../steering/index.js"

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
      <a
        key={index}
        href={part.href}
        target="_blank"
        rel="noreferrer"
        className="text-link underline"
      >
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
    <ListTag className={`m-0 list-outside pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>
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
/** Size follows depth: every heading rendering at one size makes a document's own sections indistinguishable from its subsections, which is the whole reason the depth survived into `block`. */
const HEADING_CLASSES: Record<"h2" | "h3" | "h4", string> = {
  h2: "text-large text-heading-a",
  h3: "text-body text-heading-b",
  h4: "text-small tracking-wide text-heading-c uppercase",
}

const HeadingBlock = ({ node }: { readonly node: SteeringViewNode }) => {
  const HeadingTag = headingTagFor(node.block?.depth ?? 2)
  return (
    <HeadingTag className={`m-0 px-3 pt-4 pb-1 font-semibold ${HEADING_CLASSES[HeadingTag]}`}>
      <InlineText text={node.title} />
    </HeadingTag>
  )
}

/** A `list` block's own rendering — see `HeadingBlock`'s doc comment for why this is split out. */
const ListBlock = ({ node }: { readonly node: SteeringViewNode }) => (
  <div className="px-3 py-2 marker:text-link">
    <BlockList items={node.block?.items ?? []} ordered={node.block?.ordered === true} />
  </div>
)

/** A `code` block's own rendering — see `HeadingBlock`'s doc comment for why this is split out. */
const CodeBlock = ({ node }: { readonly node: SteeringViewNode }) => (
  // `bg-surface`, never `bg-muted`: `muted` is a light TEXT colour in this
  // dark palette, so it painted a near-white slab under near-white text.
  <pre className="mx-3 my-2 overflow-x-auto rounded bg-surface p-3 text-small text-code">
    <code>{node.block?.text ?? ""}</code>
  </pre>
)

/** A `blockquote` block's own rendering — see `HeadingBlock`'s doc comment for why this is split out. */
const BlockquoteBlock = ({ node }: { readonly node: SteeringViewNode }) => (
  <blockquote className="m-0 border-l-4 border-quote px-3 py-2 text-muted italic">
    <InlineText text={node.block?.text ?? node.title} />
  </blockquote>
)

/**
 * The mark a block carries when a note is attached to it. Overlaid on the
 * block rather than placed in flow: it must be findable while SKIMMING a
 * long document — the note's own text sits below the block and is only
 * readable once you are already there. `aria-hidden` because the block's own
 * accessible name already says it has one ("Edit this block's note"), so
 * announcing it twice tells a screen-reader user nothing new.
 */
const NoteBadge = ({ index }: { readonly index: number }) => (
  <span
    data-testid={`note-badge-${index}`}
    aria-hidden="true"
    className="pointer-events-none absolute top-1 right-1 text-warning"
  >
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  </span>
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
 * other kind gets both, UNLESS `readOnly` is set: `Review.tsx`'s chunk
 * description has no per-block write path at all (a review document's only
 * phone edit is ticking a pointer's checkbox), so a caller passing
 * `readOnly` still shows an existing footnote's text inline (real content,
 * not a dead control) but never the seam — a control that would tap into a
 * no-op `onOpenNote` otherwise.
 */
// fallow-ignore-next-line complexity
const ProseBlock = ({
  node,
  index,
  noteOverrides,
  onOpenNote,
  readOnly,
}: {
  readonly node: SteeringViewNode
  readonly index: number
  readonly noteOverrides: Readonly<Record<number, string>>
  readonly onOpenNote: (node: SteeringViewNode) => void
  readonly readOnly?: boolean
}) => {
  const line = node.anchor.kind === "paragraph" ? node.anchor.line : index
  const noteText = noteOverrides[line] ?? node.note
  const hasNote = noteText !== undefined && noteText.length > 0
  const isCode = node.block?.kind === "code"
  const notable = !isCode && readOnly !== true
  return (
    <div>
      {/*
       * The note gesture is a DOUBLE TAP on the block itself — there is no
       * per-block control at all, because any control repeated once per
       * paragraph competes with the document it annotates. What that costs
       * is discoverability and a keyboard path, so both are bought back
       * here rather than left out: `ProseBlocks` states the gesture once at
       * the top, and the block is a real focusable `button`-roled target
       * that Enter/Space opens, which is also what a screen reader
       * announces. `touch-manipulation` is load-bearing on a phone: without
       * it the browser's own double-tap-to-zoom claims the same gesture.
       */}
      <div
        data-testid={notable ? `note-target-${index}` : undefined}
        {...(notable
          ? {
              role: "button",
              tabIndex: 0,
              "aria-label": hasNote ? "Edit this block's note" : "Add a note to this block",
              onDoubleClick: (event: React.MouseEvent) => {
                // A link inside the block is its own gesture — double-tapping
                // one must not also open the note sheet behind the page the
                // link is opening.
                if ((event.target as HTMLElement).closest("a") !== null) return
                onOpenNote(node)
              },
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                onOpenNote(node)
              },
            }
          : {})}
        className={`relative ${
          notable
            ? "touch-manipulation focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            : ""
        }`}
      >
        {!isCode && hasNote && <NoteBadge index={index} />}
        <BlockBody node={node} />
        {!isCode && hasNote && (
          <div data-testid={`paragraph-note-${index}`} className="px-3 pb-2 text-small text-muted">
            {noteText}
          </div>
        )}
      </div>
    </div>
  )
}

/** Prose-only rendering: one `ProseBlock` per `view.nodes` entry (each carrying a real, server-computed `paragraph` anchor — `OpenQuestions.ts#blockNodesOf`). A block already carrying a note (`node.note`, or a locally-saved override) shows it inline and offers editing via the same seam, never a second note — unless `readOnly` (see `ProseBlock`'s own doc comment), which never renders the seam at all. */
export const ProseBlocks = ({
  nodes,
  noteOverrides,
  onOpenNote,
  readOnly,
}: {
  readonly nodes: readonly SteeringViewNode[]
  readonly noteOverrides: Readonly<Record<number, string>>
  readonly onOpenNote: (node: SteeringViewNode) => void
  readonly readOnly?: boolean
}) => (
  <div data-testid="prose-paragraphs">
    {readOnly !== true && (
      <p data-testid="note-gesture-hint" className="m-0 px-3 py-2 text-small text-muted">
        Double-tap any block to note something about it.
      </p>
    )}
    {nodes.map((node, index) => (
      <ProseBlock
        key={node.anchor.kind === "paragraph" ? node.anchor.line : index}
        node={node}
        index={index}
        noteOverrides={noteOverrides}
        onOpenNote={onOpenNote}
        {...(readOnly !== undefined ? { readOnly } : {})}
      />
    ))}
  </div>
)
