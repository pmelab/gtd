import { WIRE_SCHEMA } from "./constants.js"

/** `--json` of every command that prints a script and nothing else to decide on: abandon, restore, start, door, validate, history fetch. */
export interface ScriptFields {
  readonly schema: number
  readonly script: string
}

export const scriptFields = (script: string): ScriptFields => ({ schema: WIRE_SCHEMA, script })

export const renderScriptJson = (fields: ScriptFields): string => JSON.stringify(fields) + "\n"
