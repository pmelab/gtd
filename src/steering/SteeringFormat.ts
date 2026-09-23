// Zero imports on purpose: this module is pure vocabulary, shared by the built-in
// registry (`src/SteeringFormats.ts`) and the LSP's translation layer
// (`src/Lsp.ts`) without either pulling in the other's dependencies.

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
 * One node of a format's outline tree. `leaf: true` marks a node with no
 * children of its own (an option, a hunk) — there are no other kinds beyond
 * `leaf`: a format's outline is just a tree of named, ranged nodes, and
 * whatever icon/kind an editor wants to show is the LSP translation's call,
 * not this module's.
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

/**
 * Where a cursor position in a steering file points to, for go-to-definition
 * — a `review`-mode hunk's target file/line, OR a same-document footnote
 * jump. `path` absent means "this same document" — the minimal shape that
 * carries a footnote jump without a discriminated union. `character`
 * defaults to 0 when absent.
 */
export interface SteeringPointer {
  readonly path?: string
  readonly line: number
  readonly character?: number
}

/**
 * One validation finding. `line` is 0-based; absent when the finding is
 * about the document as a whole. `range` is a separate, independently
 * optional field (never a discriminated union) — `SteeringMode.ts`'s
 * `findingsFrom` must keep constructing a bare `{ message }` for every line a
 * shell `validate:` command prints, which can never carry a position at all.
 * A `range` is meaningless without `line`, and its start line always equals
 * `line` — both pinned by tests, not the type, since the type stays flat.
 */
export interface SteeringFinding {
  readonly message: string
  readonly line?: number
  readonly range?: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  }
}

/**
 * One hunk pointer's document-link target: `range` covers exactly the
 * pointer token (`./path#42`) inside the source document; `path`/`line` name
 * where it points — `line` is 0-based, exactly like `SteeringPointer.line`:
 * a `#42` suffix resolves 1-based-to-0-based, and a bare `./path` with no
 * `#line` lands at line 0.
 */
export interface SteeringLink {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  }
  readonly path: string
  readonly line: number
}

/**
 * Where an `annotate` call attaches a note, reported back by `view` on every
 * node a note can be attached to so a client never has to invent its own
 * indices — it reads an `anchor` off the view and hands it straight back.
 * Deliberately a closed, format-agnostic union (never a format's own node
 * type): `review`'s chunk/hunk and `qa`'s question/option are different
 * shapes at the format layer but the same two kinds of thing here (a
 * "container" and "one of its numbered children"), plus `paragraph` for
 * prose neither format's `view` enumerates (a client resolves that one from
 * its own cursor position, not from the view).
 */
export type SteeringAnchor =
  | { readonly kind: "chunk"; readonly index: number }
  | { readonly kind: "hunk"; readonly chunkIndex: number; readonly index: number }
  | { readonly kind: "question"; readonly index: number }
  | { readonly kind: "option"; readonly questionIndex: number; readonly index: number }
  | { readonly kind: "paragraph"; readonly line: number }

/**
 * `annotate`'s result: either the edits to splice in, or a typed refusal —
 * `anchor-not-found` when `anchor` no longer resolves against `content`
 * (stale index, or a line that isn't a paragraph), `id-collision` when the
 * derived note id already names an existing footnote definition (see
 * `Footnotes.ts#footnoteAttachEdits`, which both built-ins delegate to).
 */
export type SteeringAnnotateResult =
  | { readonly ok: true; readonly edits: readonly SteeringEdit[] }
  | { readonly ok: false; readonly reason: "anchor-not-found" | "id-collision" }

/**
 * One item of a `list` block's own `items` tree (`SteeringViewNode.block`) —
 * recursive, so a nested list under an item is just another `items` array on
 * that item, at whatever depth the source markdown actually nests it.
 */
export interface BlockListItem {
  /** This item's own text, EXCLUDING any nested list under it (that's `items`, below). */
  readonly text: string
  /** Set only for a task-list item (`- [ ]`/`- [x]`) — absent for a plain list item. */
  readonly checked?: boolean
  /** A nested list directly under this item, recursively. Absent when this item has none. */
  readonly items?: readonly BlockListItem[]
}

/**
 * One node of a format's `view` — a generic container/item tree, the SAME
 * shape for every format, built-in or user-declared. Deliberately never a
 * closed per-format union (an earlier draft of this type was exactly that —
 * `SteeringReviewView | SteeringQaView` — which meant a third format's `view`
 * had to pretend to be one of the two, or this file had to grow a third
 * member; neither honors T1's own stated payoff, "a user-declared custom mode
 * lights up the phone UI for free"). A "container" node (a `review` chunk, a
 * `qa` question) sets `children`; an "item" node (a `review` hunk, a `qa`
 * option) has none. Every field beyond `title`/`anchor` is OPTIONAL because
 * different formats populate a different subset: `review`'s hunks set
 * `path`/`line`/`checked`/`note`; `qa`'s questions set `status`/`answered`;
 * `qa`'s options set `checked`. A THIRD format shapes its own view out of
 * this SAME node type, needing no change here — mirrors `SteeringAnchor`'s
 * own container/child genericity above.
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
  /** A file path this node points at, when it has one (a `review` hunk). */
  readonly path?: string
  /** A 1-based line in `path` this node points at, when it has one. */
  readonly line?: number
  /** Where `annotate` attaches a NEW note to this node. */
  readonly anchor: SteeringAnchor
  readonly children?: readonly SteeringViewNode[]
  /**
   * A node's own body, projected as block nodes — a SIBLING of `children`,
   * never a reuse of it: `children` on a `qa` question node means its
   * options (`Question.tsx` maps them to radio rows), so a body block riding
   * in that same array would render as a phantom option; a `review` chunk
   * node has no `children` collision to worry about, but keeps the same
   * split for consistency. Each body node carries its own real
   * `{kind: "paragraph", line}` anchor (`OpenQuestions.ts#questionBodyNodes`,
   * `review.ts#parseChunkBody`'s `descriptionNodes`, both via
   * `Blocks.ts#blockNodesOfRun`) — no new `SteeringAnchor` member exists for
   * it. Set by `qa` questions and `review` chunks alike; `[]` for either one
   * with no body at all — never merely absent on a node that legitimately
   * carries this field, so `node.body !== undefined` alone is not "this is a
   * question" (`Review.tsx` sets it too).
   */
  readonly body?: readonly SteeringViewNode[]
  /**
   * The document structure a prose block carries (`OpenQuestions.ts#blockOf`)
   * — NO new anchor kind: every block, whatever `kind` it names here, still
   * anchors as `{kind: "paragraph", line}` (`SteeringAnchor` gains no member).
   * Absent for a non-`qa`/`review` node (a chunk, a hunk, a question, an
   * option) and for a malformed block with no real position — a client that
   * ignores this field entirely still has `title` to render.
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
  }
}

/**
 * A format's whole domain projection of `content` — what the phone UI
 * actually renders. `header` is a document-level label when the format has
 * one (`review`'s short hash); `nodes` are the top-level `SteeringViewNode`s.
 * Never a discriminated union of per-format shapes — see `SteeringViewNode`'s
 * own doc comment for why. The server never imports a format module or
 * switches on the mode name either way: it just serializes whatever `view`
 * returns and lets the client's own renderer walk the generic tree.
 */
export interface SteeringView {
  readonly header?: string
  readonly nodes: readonly SteeringViewNode[]
}

/**
 * One steering-file FORMAT's whole behavior: how to validate it in process,
 * build its outline, offer code actions at a range, and (optionally) resolve
 * a cursor position to a pointer elsewhere. `validate` returns the same
 * `findings` shape `gtd validate` and the capture gate both consume (empty =
 * valid). `pointerAt` is absent for a format with nothing to jump to; both
 * built-ins declare one — `qa` for footnote jumps only, `review` for
 * footnote jumps plus its hunk-pointer jump into another file.
 */
export interface SteeringFormat {
  /**
   * A canonical, hand-authored example of this format — the CLEAREST minimal
   * document that satisfies its own `validate`, nothing more. Required so a
   * new built-in format can't ship without one: `src/steering/SteeringFormats.test.ts`
   * asserts `validate(sample)` returns zero findings for every registry entry,
   * and `src/ModeContradiction.ts` round-trips this exact string through a
   * mode's `format:` command to catch a formatter that breaks its own
   * validator. Deliberately NOT authored to survive any particular formatter
   * — a formatter that reflows this sample into something invalid IS the
   * contradiction the round-trip exists to find.
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
  /**
   * Every hunk-pointer document link in `content`, declared by `review` and
   * absent on `qa`. Walks the parsed hunks directly rather than calling
   * `pointerAt` per line — that path is one call per line and cannot yield
   * the token's own range, which is the whole point of a document link.
   */
  readonly documentLinks?: (content: string) => readonly SteeringLink[]
  /**
   * This format's domain projection of `content` — MANDATORY (unlike
   * `pointerAt`/`documentLinks`), so the server never has to import a format
   * module or switch on the mode name to render the phone UI: it reads a
   * `view` and produces edits through the registry, exactly as it already
   * reads `outline`/`actions`/`pointerAt`. A user-declared custom mode lights
   * up the phone UI for free the moment it registers one.
   */
  readonly view: (content: string) => SteeringView
  /**
   * The other mandatory member: turns an `anchor` (as reported by this same
   * format's `view`, or a `paragraph` anchor a client resolves itself) plus
   * `text` — the human's own typed note body, carried verbatim into the new
   * definition — into the byte-range edits that attach it there, or a typed
   * refusal when the anchor doesn't resolve. `text` is never a placeholder:
   * unlike the LSP's own "gtd: add a footnote" action (which seeds a
   * definition for a human to fill in afterward, `Footnotes.ts`'s
   * `footnoteAdditionEdits`), a server-attached note already has its real
   * body at attach time, so the document it produces validates clean
   * immediately — requirement 5's "writes through immediately". Every
   * built-in implementation delegates to `Footnotes.ts#footnoteAttachEdits`
   * for the actual two-edit mechanics.
   */
  readonly annotate: (
    content: string,
    anchor: SteeringAnchor,
    text: string,
  ) => SteeringAnnotateResult
  /**
   * The checkbox-writing counterpart to `annotate`: turns an `anchor` (as
   * reported by this same format's `view`) plus a desired `checked` state
   * and/or replacement `text` into the byte-range edits that set it, or the
   * SAME typed refusal shape `annotate` returns (`apply` never produces
   * `id-collision` itself — it edits an existing checkbox rather than
   * attaching a new footnote — but keeps the shape for uniformity). `qa`'s
   * `option` anchor is RADIO: ticking one option unticks every sibling of the
   * same question; ticking the free-text slot with `text` set also replaces
   * its label, both in ONE edit set. `review`'s `hunk` anchor sets that one
   * hunk's tick; its `chunk` anchor sets every hunk beneath it, at any
   * nesting depth, to the SAME target state the caller already knows — never
   * a majority-flip heuristic, unlike `ReviewDoc.ts`'s own cursor-driven
   * `toggleChunkEdits`. An anchor of the wrong kind for this format (a `hunk`
   * anchor given to `qa`, say) or a stale index refuses `anchor-not-found`,
   * exactly as `annotate` does.
   */
  readonly apply: (
    content: string,
    anchor: SteeringAnchor,
    opts: { readonly checked?: boolean; readonly text?: string },
  ) => SteeringAnnotateResult
}
