/**
 * The shape of a steering-file FORMAT — what a file of some kind (`qa`,
 * `review`, ...) IS: how it validates, what its editor outline looks like,
 * which edits a code action can make, and (for a format whose entries point
 * elsewhere, like `review`'s hunk pointers) where a cursor position resolves
 * to. Zero imports on purpose: this module is pure vocabulary, shared by the
 * built-in registry (`src/SteeringFormats.ts`) and the LSP's translation
 * layer (`src/Lsp.ts`) without either pulling in the other's dependencies.
 *
 * A steering MODE (see `src/SteeringMode.ts`) is a format PLUS who validates
 * it — a mode may point at a built-in format's shell command instead of its
 * parser. The format is what the file is; the mode is that name plus how a
 * particular workflow validates it.
 */

/** A single-range text replacement — the same shape `vscode-languageserver`'s `TextEdit` carries, kept format-side so this module stays protocol-independent. */
export interface SteeringEdit {
  readonly range: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  }
  readonly newText: string
}

/** One offered code action: a human-readable title plus the edits it would make. */
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

/** Where a cursor position in a steering file points to — a `review`-mode hunk's target file/line, for go-to-definition. */
export interface SteeringPointer {
  readonly path: string
  readonly line: number
}

/** One validation finding. `line` is 0-based; absent when the finding is about the document as a whole. */
export interface SteeringFinding {
  readonly message: string
  readonly line?: number
}

/**
 * One steering-file FORMAT's whole behavior: how to validate it in process,
 * build its outline, offer code actions at a range, and (optionally) resolve
 * a cursor position to a pointer elsewhere. `validate` returns the same
 * `findings` shape `gtd validate` and the capture gate both consume (empty =
 * valid). `pointerAt` is absent for a format with nothing to jump to (`qa`
 * has none; `review` does).
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
  readonly pointerAt?: (content: string, line: number) => SteeringPointer | undefined
}
