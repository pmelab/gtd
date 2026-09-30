// `InlineNode` aside, pure vocabulary: shared by the registry and the LSP's
// translation layer without either pulling in the other's dependencies.
import type { InlineNode } from "./Inline.js"

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
}

/**
 * One node of a format's outline tree. `leaf: true` is the only distinction
 * a node carries — whatever icon or symbol kind an editor shows is the LSP
 * translation's call, not this module's.
 */
export interface SteeringOutlineNode {
  readonly name: string
  readonly detail?: string
  readonly range: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  }
  readonly selectionRange: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  }
  readonly leaf?: true
  readonly children?: readonly SteeringOutlineNode[]
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
 * hands it straight back, never inventing indices. Deliberately closed and
 * format-agnostic: `review`'s chunk/hunk and `qa`'s question/option are the
 * same two things here (a container and one of its numbered children), plus
 * `paragraph`, which a client resolves from its cursor rather than the view.
 */
export type SteeringAnchor =
  | { readonly kind: "chunk"; readonly index: number }
  | { readonly kind: "hunk"; readonly chunkIndex: number; readonly index: number }
  | { readonly kind: "question"; readonly index: number }
  | { readonly kind: "option"; readonly questionIndex: number; readonly index: number }
  | { readonly kind: "paragraph"; readonly line: number }

/** `annotate`'s result: the edits to splice in, or a typed refusal — a stale/unresolvable `anchor`, or a derived note id that already names a definition. */
export type SteeringAnnotateResult =
  | { readonly ok: true; readonly edits: readonly SteeringEdit[] }
  | { readonly ok: false; readonly reason: "anchor-not-found" | "id-collision" }

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
}

/**
 * One node of a format's `view`: a generic container/item tree, the SAME
 * shape for every format. Deliberately never a closed per-format union — a
 * third format would have to pretend to be one of the two, or this file would
 * grow a member, and a user-declared mode is supposed to light up the phone
 * UI for free. Every field beyond `title`/`anchor` is optional because each
 * format populates a different subset.
 */
export interface SteeringViewNode {
  /** This node's own display name — a chunk's/question's title, an option's/hunk's own label. */
  readonly title: string
  /** A longer description or summary, when the format has one (a chunk's description, a question's first body line). */
  readonly detail?: string
  /** A free-form status label, when the format has one (`qa`'s `"open"`/`"answered"`). */
  readonly status?: string
  /** `true` when this node's own condition is fully satisfied (`qa`'s answered-question flag) — distinct from `checked`, which is a per-item tick. */
  readonly answered?: boolean
  /** This node's own checkbox state, when it has one (a hunk's tick, an option's tick). */
  readonly checked?: boolean
  /** An attached note's text, when this node carries one. */
  readonly note?: string
  /**
   * `detail`'s own inline counterpart, for the three compact rows (a chunk
   * card, a hunk's description row, a plan row): built server-side by
   * concatenating each contributing block's own inline run with a single
   * space `text` separator, mirroring exactly how `detail` itself joins.
   * Block structure stays flattened — a list contributes its items' runs
   * joined by spaces, a fence contributes its plain text — and an image
   * collapses to its alt text unconditionally, so a compact row can never
   * fire a remote fetch. Set by `review.ts` (chunk, hunk) and `qa.ts`
   * (question); absent wherever `detail` itself is absent.
   */
  readonly detailInline?: readonly InlineNode[]
  /** A file path this node points at, when it has one (a `review` hunk). */
  readonly path?: string
  /** A 1-based line in `path` this node points at, when it has one. */
  readonly line?: number
  /** A 1-based END line in `path`, alongside `line`, for a `review` hunk pointer carrying a range (`#<start>-<end>`). Absent whenever `line` is absent, or for a bare `#<line>` pointer with no range. */
  readonly endLine?: number
  /** Where `annotate` attaches a NEW note to this node. */
  readonly anchor: SteeringAnchor
  readonly children?: readonly SteeringViewNode[]
  /**
   * A node's body, a SIBLING of `children` and never a reuse of it: a `qa`
   * question's `children` are its options, so a body block riding in that
   * array would render as a phantom option.
   *
   * Set by `qa` questions, `review` chunks, and a `qa` OPTION node too, where
   * it is that option's own impacts — read-only, since the write-back span an
   * answer commits through never reaches past the option's label. `[]` — not
   * absent — for a question/chunk with no body, so `body !== undefined` is
   * never "this is a question"; absent entirely on the free-text slot, which
   * never carries impacts.
   */
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
    /**
     * This block's own text, verbatim. `qa`/`review` set it only for
     * `kind: "code"`/`"blockquote"` (the code block's body / the
     * blockquote's own text); the free-form format (`freeform.ts`) sets it
     * for EVERY kind — the block's own raw source bytes, unmodified — since
     * it has no structure of its own to fall back on and an edit there
     * replaces a block's whole source span with this same shape of text.
     */
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

/** A format's whole domain projection of `content`. The server serializes this without importing a format module or switching on the mode name. */
export interface SteeringView {
  readonly header?: string
  readonly nodes: readonly SteeringViewNode[]
}

/**
 * One steering-file FORMAT's whole behavior. `validate` returns the same
 * `findings` shape `gtd validate` and the capture gate consume (empty =
 * valid); `pointerAt` is absent for a format with nothing to jump to.
 */
export interface SteeringFormat {
  /**
   * The clearest minimal document that satisfies this format's own `validate`.
   * `ModeContradiction.ts` round-trips this exact string through a mode's
   * `format:` command to catch a formatter that breaks its own validator, so
   * it is deliberately NOT authored to survive any particular formatter — a
   * reflow that invalidates it IS the contradiction that check exists to find.
   */
  readonly sample: string
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
  /** MANDATORY, so a user-declared mode lights up the phone UI the moment it registers one — the server reads a `view` rather than importing a format module. */
  readonly view: (content: string) => SteeringView
  /**
   * Attaches a note at `anchor`. `text` is never a placeholder — unlike the
   * LSP's "add a footnote" action, which seeds an empty definition for a human
   * to fill in, a server-attached note already has its real body, so the
   * document it produces validates clean immediately.
   */
  readonly annotate: (
    content: string,
    anchor: SteeringAnchor,
    text: string,
  ) => SteeringAnnotateResult
  /**
   * The checkbox-writing counterpart to `annotate`, sharing its refusal shape.
   * `qa`'s `option` anchor is RADIO: ticking one unticks every sibling, and
   * ticking the free-text slot with `text` set also replaces its label, in ONE
   * edit set. `review`'s `chunk` anchor sets every hunk beneath it to the
   * caller's stated target state — never a majority-flip heuristic.
   */
  readonly apply: (
    content: string,
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ) => SteeringAnnotateResult
  /**
   * Resets only THIS format's own read-progress ticks. `qa`'s checkbox ticks
   * ARE its answers — never auto-cleared; `review`'s hunk ticks are
   * read-progress, cleared on every land. Mandatory so a format can never
   * accidentally inherit another one's tick-clearing rule.
   */
  readonly clearTicks: (content: string) => string
  /**
   * `qa`-only: every OPEN question not yet answered — distinct from
   * `validate`'s structural findings, since a well-formed document can still
   * have open questions nobody answered. Absent on a format with no such
   * concept.
   */
  readonly unansweredQuestions?: (content: string) => readonly {
    readonly question: string
    readonly headingLine: number
  }[]
}
