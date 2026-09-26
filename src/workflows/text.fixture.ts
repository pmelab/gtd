import { installContext, type Refs } from "../flows/index.js"
import * as text from "./text.js"
import { defaults } from "./vars.js"

export interface TextContext {
  readonly vars?: Readonly<Record<string, string>>
  readonly refs?: Partial<Refs>
  readonly read?: (path: string) => string | undefined
}

const unavailable = (): never => {
  throw new Error("not available while rendering a text outside a replay")
}

/** Evaluate one of the bundled workflow's texts the way replay would, against a fixed context. */
const renderText = <T>(text: () => T, context: TextContext = {}): T => {
  const read = context.read ?? (() => undefined)
  installContext({
    step: unavailable,
    refuse: unavailable,
    pushScope: unavailable,
    popScope: unavailable,
    pushPersona: unavailable,
    popPersona: unavailable,
    exists: (path) => read(path) !== undefined,
    read,
    glob: () => [],
    changes: () => ({ added: [], modified: [], deleted: [] }),
    matches: () => false,
    tail: (pathOrContent) => read(pathOrContent) ?? pathOrContent,
    previous: () => undefined,
    sections: () => [],
    stepName: (name) => name,
    vars: { ...defaults, ...context.vars },
    refs: { start: "", head: "", reviewBase: "", processBase: "", ...context.refs },
  })
  try {
    return text()
  } finally {
    installContext(undefined)
  }
}

type ScriptName = {
  [K in keyof typeof text]: K extends `${string}Script` ? K : never
}[keyof typeof text]

export const SCRIPT_NAMES = Object.keys(text)
  .filter((name) => name.endsWith("Script"))
  .sort() as ScriptName[]

/** Render the bundled script `name`; `describeStep` feeds the one script that takes an argument. */
export const renderScript = (
  name: ScriptName,
  context: TextContext = {},
  describeStep = "build.health.describe",
): string => renderText(() => (text[name] as (step: string) => string)(describeStep), context)
