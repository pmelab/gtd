// `InlineNode` aside, pure vocabulary: shared by the registry and the LSP's
// translation layer without either pulling in the other's dependencies.
import type { InlineNode } from "./Inline.js"
import type { SteeringOutlineNode } from "./Outline.js"

export type { SteeringOutlineNode } from "./Outline.js"

/** The same shape `vscode-languageserver`'s `TextEdit` carries, kept format-side so this module stays protocol-independent. */
export interface SteeringEdit {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  }
  readonly newText: string
}

export interface SteeringAction {
  readonly title: string
  readonly edits: readonly SteeringEdit[]
  /** A range the editor selects once the edits apply; absent means no reveal. */
  readonly select?: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  }
}

/** A go-to-definition target. `path` absent means "this same document" (a footnote jump); `character` defaults to 0. */
export interface SteeringPointer {
  readonly path?: string
  readonly line: number
  readonly character?: number
}

/**
 * One validation finding. `line` is 0-based, absent for a document-level
 * finding. `range` is independently optional, never a discriminated union:
 * a shell `validate:` command's output is a bare `{ message }` with no
 * position at all. That a `range` implies a `line` is pinned by tests.
 */
export interface SteeringFinding {
  readonly message: string
  readonly line?: number
  readonly range?: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  }
}

/** `file:line:col: message` — the shape editors and grep already jump on. Stored 0-based, printed 1-based. A finding with a `line` but no `range`, or none at all, degrades to the shorter forms. */
export const formatFinding = (file: string, finding: SteeringFinding): string => {
  if (finding.line === undefined) return finding.message
  const col = finding.range !== undefined ? `:${finding.range.start.character + 1}` : ""
  return `${file}:${finding.line + 1}${col}: ${finding.message}`
}

/** A hunk pointer's document-link target: `range` covers the pointer token itself; `line` is 0-based, so a `#42` suffix resolves down by one and a bare `./path` lands at 0. */
export interface SteeringLink {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  }
  readonly path: string
  readonly line: number
}

/**
 * Where an `annotate` call attaches a note. A client reads one off `view` and
 * hands it straight back, never inventing indices: `question`/`chunk` name
 * an input widget by its index among the input widgets, `option`/`hunk` one of
 * its checkboxes, and `paragraph` a block a client resolves from its cursor.
 */
export type SteeringAnchor =
  | { readonly kind: "chunk"; readonly index: number }
  | { readonly kind: "hunk"; readonly chunkIndex: number; readonly index: number }
  | { readonly kind: "question"; readonly index: number }
  | { readonly kind: "option"; readonly questionIndex: number; readonly index: number }
  | { readonly kind: "paragraph"; readonly line: number }

type SteeringRefusalReason = "anchor-not-found" | "id-collision"

/** `annotate`'s result: the edits to splice in, or a typed refusal — a stale/unresolvable `anchor`, or a derived note id that already names a definition. */
export type SteeringAnnotateResult =
  | { readonly ok: true; readonly edits: readonly SteeringEdit[] }
  | { readonly ok: false; readonly reason: SteeringRefusalReason }

/** One item of a `list` block's `items` tree — recursive to whatever depth the source markdown nests. */
export interface BlockListItem {
  /** This item's own text, EXCLUDING any nested list under it (that's `items`, below). */
  readonly text: string
  /** Set only for a task-list item (`- [ ]`/`- [x]`) — absent for a plain list item. */
  readonly checked?: boolean
  /** A nested list directly under this item, recursively. Absent when this item has none. */
  readonly items?: readonly BlockListItem[]
  /** `text`'s own inline structure — the shared renderer walks this instead of `text` when present. Populated at every nesting depth. */
  readonly inline?: readonly InlineNode[]
  /** The item's own 0-based source line: a `paragraph` anchor at it notes this item alone. */
  readonly line?: number
  /** The note whose marker sits on `line`, as on a view node. */
  readonly note?: string
}

/**
 * One node of the phone's view: a prose block, a widget (`status` names its
 * kind), or one of a widget's checkboxes. Every field beyond `title`/`anchor`
 * is optional because each kind of node fills a different subset.
 */
export interface SteeringViewNode {
  /** This node's own display name — a widget's title, a checkbox's label. */
  readonly title: string
  /** A widget's description. */
  readonly detail?: string
  /** A widget's kind, or `"custom"` on a select's ✏️ answer. */
  readonly status?: string
  /** `false` for a widget a person still has to answer — distinct from `checked`, which is a per-item tick. */
  readonly answered?: boolean
  /** This node's own checkbox state, when it has one. */
  readonly checked?: boolean
  /** The annotation attached to this node, when it carries one. */
  readonly note?: string
  /**
   * `detail`'s own inline counterpart, for the three compact rows (a chunk
   * card, a hunk's description row, a plan row): built server-side by
   * concatenating each contributing block's own inline run with a single
   * space `text` separator, mirroring exactly how `detail` itself joins.
   * Block structure stays flattened — a list contributes its items' runs
   * joined by spaces, a fence contributes its plain text — and an image
   * collapses to its alt text unconditionally, so a compact row can never
   * fire a remote fetch. Absent wherever `detail` itself is absent.
   */
  readonly detailInline?: readonly InlineNode[]
  /** The file a hunk points at. */
  readonly path?: string
  /** A 1-based line in `path` this node points at, when it has one. */
  readonly line?: number
  /** A 1-based END line in `path`, alongside `line`, for a hunk pointer carrying a range (`#<start>-<end>`). */
  readonly endLine?: number
  /** Where `annotate` attaches a NEW note to this node. */
  readonly anchor: SteeringAnchor
  readonly children?: readonly SteeringViewNode[]
  /** Blocks rendered with a node, a sibling of `children` so they never render as checkboxes. */
  readonly body?: readonly SteeringViewNode[]
  /**
   * The document structure a prose block carries. NO new anchor kind: whatever
   * `kind` it names, the block still anchors as `{kind: "paragraph", line}`. A
   * client that ignores this field entirely still has `title` to render.
   */
  readonly block?: {
    readonly kind: "paragraph" | "heading" | "list" | "code" | "blockquote"
    /** Heading level, 1–6. Set only for `kind: "heading"`. */
    readonly depth?: number
    /** Set only for `kind: "list"`. */
    readonly ordered?: boolean
    /** This list's own top-level items, recursive. Set only for `kind: "list"`. */
    readonly items?: readonly BlockListItem[]
    /** The fenced code block's info-string language, when it has one. Set only for `kind: "code"`. */
    readonly language?: string
    /** This block's own source text, verbatim. */
    readonly text?: string
    /**
     * This block's own inline structure — set only for `kind: "paragraph"`,
     * `"heading"` and `"blockquote"` (a `code` block's `text` has none; a
     * `list` block's own items each carry their own `inline` instead, on
     * `BlockListItem`). The shared client renderer walks this instead of
     * `title`/`text` when present, so `**bold**` and friends survive as real
     * structure rather than literal markers.
     */
    readonly inline?: readonly InlineNode[]
  }
}

/** A steering file's whole projection for the phone. */
export interface SteeringView {
  readonly header?: string
  readonly nodes: readonly SteeringViewNode[]
}

/**
 * The steering format's whole behaviour for the editor and the phone.
 * `validate` returns findings (empty = valid).
 */
export interface SteeringFormat {
  readonly validate: (content: string) => readonly SteeringFinding[]
  readonly outline: (content: string) => readonly SteeringOutlineNode[]
  readonly actions: (
    content: string,
    range: {
      readonly start: { readonly line: number; readonly character: number }
      readonly end: { readonly line: number; readonly character: number }
    },
  ) => readonly SteeringAction[]
  readonly pointerAt?: (
    content: string,
    position: { readonly line: number; readonly character: number },
  ) => SteeringPointer | undefined
  /** Every hunk-pointer document link in `content`. Walks the parsed hunks directly: `pointerAt` is one call per line and cannot yield the token's own range. */
  readonly documentLinks?: (content: string) => readonly SteeringLink[]
  /** What the phone renders. */
  readonly view: (content: string) => SteeringView
  /** Attaches an annotation carrying `text` at `anchor`. */
  readonly annotate: (
    content: string,
    anchor: SteeringAnchor,
    text: string,
  ) => SteeringAnnotateResult
  /**
   * The checkbox-writing counterpart to `annotate`, sharing its refusal shape.
   * A single select's option is a radio: ticking it unticks the others. A
   * `question`/`chunk` anchor on a review checklist sets every hunk at once.
   */
  readonly apply: (
    content: string,
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ) => SteeringAnnotateResult
}
