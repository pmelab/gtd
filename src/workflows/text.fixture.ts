import { installContext } from "../flows/index.js"
import { defaults } from "./vars.js"

export interface TextContext {
  readonly vars?: Readonly<Record<string, string>>
  readonly head?: string
  readonly start?: string
  readonly read?: (path: string) => string | undefined
}

const unavailable = (): never => {
  throw new Error("not available while rendering a text outside a replay")
}

/** Evaluate one of the bundled workflow's texts the way replay would, against a fixed context. */
export const renderText = <T>(text: () => T, context: TextContext = {}): T => {
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
