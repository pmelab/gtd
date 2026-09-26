import { installContext } from "../flows/index.js"
import * as text from "./text.js"
import { defaults } from "./vars.js"

export interface TextContext {
  readonly vars?: Readonly<Record<string, string>>
  readonly head?: string
  readonly start?: string
  /** The review base handed to the scripts that take one. */
  readonly base?: string
  readonly read?: (path: string) => string | undefined
}

const unavailable = (): never => {
  throw new Error("not available while rendering a text outside a replay")
}

/** Evaluate one of the bundled workflow's texts the way replay would, against a fixed context. */
const renderText = <T>(text: () => T, context: TextContext = {}): T => {
  installContext({
    step: unavailable,
    refuse: unavailable,
    pushScope: unavailable,
    popScope: unavailable,
    read: context.read ?? (() => undefined),
    glob: () => [],
    changes: () => [],
    matches: () => false,
    sections: () => [],
    openQuestions: () => [],
    vars: { ...defaults, ...context.vars },
    head: () => context.head ?? "",
    start: () => context.start ?? "",
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

export const renderScript = (name: ScriptName, context: TextContext = {}): string =>
  renderText(() => (text[name] as (base: string) => string)(context.base ?? ""), context)
