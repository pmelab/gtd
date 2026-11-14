import type {
  SteeringAction,
  SteeringFormat,
  SteeringLink,
  SteeringOutlineNode,
  SteeringPointer,
} from "./SteeringFormat.js"

/**
 * Every positional thing an editor (the LSP, in a later pass) needs for one
 * document, off ONE `viewOf` call rather than four separate ones re-deriving
 * ranges each time: `outline` and `documentLinks` are already fully resolved
 * (each node/link carries its own range — see `SteeringOutlineNode`/
 * `SteeringLink`), while `pointerAt`/`actionsAt` stay closures over `content`
 * because they need a cursor position/selection range the caller supplies
 * per request. `Lsp.ts` reads its ranges straight off `outline`/`documentLinks`.
 */
export interface SteeringEditorView {
  readonly outline: readonly SteeringOutlineNode[]
  readonly documentLinks: readonly SteeringLink[]
  readonly pointerAt: (position: {
    readonly line: number
    readonly character: number
  }) => SteeringPointer | undefined
  readonly actionsAt: (range: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  }) => readonly SteeringAction[]
}

/** Builds `format`'s `SteeringEditorView` of `content` — see `SteeringEditorView`'s own doc for why this is one value, not several. Distinct from `SteeringView` (`SteeringFormat.ts`), which is the format's own node tree the phone client renders. */
export const viewOf = (format: SteeringFormat, content: string): SteeringEditorView => ({
  outline: format.outline(content),
  documentLinks: format.documentLinks ? format.documentLinks(content) : [],
  pointerAt: (position) => format.pointerAt?.(content, position),
  actionsAt: (range) => format.actions(content, range),
})
