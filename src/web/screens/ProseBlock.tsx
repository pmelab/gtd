import { MessageSquarePlus, MessageSquareText } from "lucide-react"
import { cn } from "../cn.js"
import { TOKEN_COLOR, tokenize } from "../Highlight.js"
import type { ReactElement } from "react"
import type { BlockListItem, SteeringViewNode } from "../../steering/index.js"
import { Inline } from "./InlineRun.js"

/** The page header holds the `h1`, so a markdown `#` is an `h2`. */
const headingTagFor = (depth: number): "h2" | "h3" | "h4" | "h5" =>
  depth <= 1 ? "h2" : depth === 2 ? "h3" : depth === 3 ? "h4" : "h5"

/** A checkbox in static content: shown, never an input — only a widget's boxes are answers. */
const TaskBox = ({ item }: { readonly item: BlockListItem }) => (
  <input
    type="checkbox"
    checked={item.checked === true}
    readOnly
    className="mr-2 size-4 align-[-0.15em] accent-foreground"
  />
)

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
    <ListTag
      className={`m-0 list-outside space-y-1 pl-5 marker:text-muted-foreground ${ordered ? "list-decimal" : "list-disc"}`}
    >
      {items.map((item, index) => (
        <li key={index} className="pl-1 [&>ol]:mt-1 [&>ul]:mt-1">
          {item.checked !== undefined && <TaskBox item={item} />}
          <Inline inline={item.inline} fallback={item.text} />
          {item.items !== undefined && <BlockList items={item.items} ordered={ordered} />}
        </li>
      ))}
    </ListTag>
  )
}

const HEADING_CLASSES: Record<"h2" | "h3" | "h4" | "h5", string> = {
  h2: "text-2xl",
  h3: "text-xl",
  h4: "text-lg",
  h5: "text-base",
}

const HeadingBlock = ({ node }: { readonly node: SteeringViewNode }) => {
  const HeadingTag = headingTagFor(node.block?.depth ?? 2)
  return (
    <HeadingTag
      className={`m-0 py-1 leading-tight font-semibold tracking-tight text-heading ${HEADING_CLASSES[HeadingTag]}`}
    >
      <Inline inline={node.block?.inline} fallback={node.title} />
    </HeadingTag>
  )
}

const ListBlock = ({ node }: { readonly node: SteeringViewNode }) => (
  <div className="py-1">
    <BlockList items={node.block?.items ?? []} ordered={node.block?.ordered === true} />
  </div>
)

const CodeBlock = ({ node }: { readonly node: SteeringViewNode }) => {
  const text = node.block?.text ?? ""
  const language = node.block?.language?.toLowerCase()
  return (
    <pre
      data-language={language}
      className="scrollbar-thin m-0 overflow-x-auto rounded-md border border-border bg-code-bg p-3 font-mono text-sm leading-relaxed text-foreground"
    >
      <code>
        {tokenize(text, language ?? "").map((token, i) => (
          <span
            key={i}
            className={token.className !== undefined ? TOKEN_COLOR[token.className] : undefined}
          >
            {token.text}
          </span>
        ))}
      </code>
    </pre>
  )
}

const BlockquoteBlock = ({ node }: { readonly node: SteeringViewNode }) => {
  const paragraphs = node.block?.paragraphs
  return (
    <blockquote className="m-0 rounded-md border border-border bg-muted px-4 py-3 text-muted-foreground">
      {paragraphs !== undefined && paragraphs.length > 1 ? (
        paragraphs.map((run, index) => (
          <p key={index} className="m-0 leading-relaxed [&:not(:first-child)]:mt-3">
            <Inline inline={run} fallback="" />
          </p>
        ))
      ) : (
        <Inline inline={node.block?.inline} fallback={node.block?.text ?? node.title} />
      )}
    </blockquote>
  )
}

/** The fallback when `block` is absent or of a kind without its own renderer: `title` still shows. */
const ParagraphBlock = ({ node }: { readonly node: SteeringViewNode }) => (
  <p className="m-0 py-1 leading-relaxed">
    <Inline inline={node.block?.inline} fallback={node.title} />
  </p>
)

const BLOCK_RENDERERS: Record<
  string,
  (props: { readonly node: SteeringViewNode }) => ReactElement
> = {
  heading: HeadingBlock,
  list: ListBlock,
  code: CodeBlock,
  blockquote: BlockquoteBlock,
}

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
 * other kind gets both, UNLESS `readOnly` is set: a caller with no per-block
 * write path (a question option's impact list, say) still shows an existing
 * footnote's text inline (real content, not a dead control) but never the
 * seam — a control that would tap into a no-op `onOpenNote` otherwise.
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
  const override = noteOverrides[line]
  const noteText = override ?? node.note
  const hasNote = noteText !== undefined && noteText.length > 0
  const isCode = node.block?.kind === "code"
  const notable = !isCode && readOnly !== true
  return (
    <div
      data-testid={node.changed ? "changed-block" : undefined}
      className={cn(
        node.block?.kind === "heading" ? "mt-8 mb-1 first:mt-0" : "mt-2 first:mt-0",
        node.changed && "border-l-2 border-warning pl-2",
      )}
    >
      {node.changed && <span className="sr-only">Changed since you last landed this file</span>}
      {/*
       * The note gesture is a DOUBLE TAP on the block itself — there is no
       * per-block control at all, because any control repeated once per
       * paragraph competes with the document it annotates. What that costs
       * is discoverability and a keyboard path, so both are bought back
       * here rather than left out: the document states the gesture once at
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
        className={cn(
          "relative -mx-2 rounded-md px-2",
          notable &&
            "min-h-11 touch-manipulation transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring pointer-fine:hover:bg-accent/60",
          !isCode && hasNote && "bg-muted py-1 pointer-fine:hover:bg-accent",
        )}
      >
        <BlockBody node={node} />
        {!isCode && hasNote && (
          <p
            data-testid={`paragraph-note-${index}`}
            className="m-0 mt-1 mb-1 flex gap-2 border-t border-border pt-2 text-sm text-foreground"
          >
            <MessageSquareText
              aria-hidden="true"
              data-testid={`note-badge-${index}`}
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
            <span className="min-w-0">{noteText}</span>
          </p>
        )}
      </div>
    </div>
  )
}

/** A block already carrying a note shows it inline and edits it through the same seam, never a second note. */
export const ProseBlocks = ({
  nodes,
  noteOverrides,
  onOpenNote,
  readOnly,
  hideFirst = false,
}: {
  readonly nodes: readonly SteeringViewNode[]
  readonly noteOverrides: Readonly<Record<number, string>>
  readonly onOpenNote: (node: SteeringViewNode) => void
  readonly readOnly?: boolean
  /** Skips the first block but keeps every other block's index. */
  readonly hideFirst?: boolean
}) => (
  <div data-testid="prose-paragraphs">
    {nodes.map((node, index) =>
      hideFirst && index === 0 ? null : (
        <ProseBlock
          key={node.anchor.kind === "paragraph" ? node.anchor.line : index}
          node={node}
          index={index}
          noteOverrides={noteOverrides}
          onOpenNote={onOpenNote}
          {...(readOnly !== undefined ? { readOnly } : {})}
        />
      ),
    )}
  </div>
)

/** Shown once per page: the note gesture has no visible control of its own. */
export const NoteGestureHint = () => (
  <p
    data-testid="note-gesture-hint"
    className="m-0 mb-4 flex items-center gap-2 text-sm text-muted-foreground"
  >
    <MessageSquarePlus aria-hidden="true" className="size-4 shrink-0" />
    <span className="hidden pointer-coarse:inline">Double-tap any block to add a note.</span>
    <span className="hidden pointer-fine:inline">
      Double-click any block, or focus it and press Enter, to add a note.
    </span>
  </p>
)
