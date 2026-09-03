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
   * new built-in format can't ship without one: `src/SteeringFormats.test.ts`
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
}
