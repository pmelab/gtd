import { WIRE_SCHEMA } from "./constants.js"

export interface SliceEntry {
  readonly name: string
  readonly base: string
  readonly tip: string
  readonly closed: boolean
}

export interface SlicesDocument {
  readonly schema: number
  readonly slices: readonly SliceEntry[]
}

/** The ONLY place `gtd slices --json`'s shape is built; copies exactly the four fields, in order. */
export const slicesDocument = (slices: readonly SliceEntry[]): SlicesDocument => ({
  schema: WIRE_SCHEMA,
  slices: slices.map(({ name, base, tip, closed }) => ({ name, base, tip, closed })),
})

export const renderSlicesJson = (document: SlicesDocument): string =>
  JSON.stringify(document) + "\n"
