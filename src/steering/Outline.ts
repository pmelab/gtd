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
