import { installContext, type StepRequest } from "../flows/index.js"
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
    changesSince: unavailable,
    matches: () => false,
    sections: () => [],
    sectionBodies: () => [],
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

/** Run `fn`, recording the one `StepRequest` it issues, against the same fixed context `renderText` installs. */
export const captureStep = async (
  fn: () => Promise<void>,
  context: TextContext = {},
): Promise<StepRequest> => {
  let captured: StepRequest | undefined
  installContext({
    step: (request) => {
      captured = request
      return Promise.resolve()
    },
    refuse: unavailable,
    pushScope: unavailable,
    popScope: unavailable,
    read: context.read ?? (() => undefined),
    glob: () => [],
    changes: () => [],
    changesSince: unavailable,
    matches: () => false,
    sections: () => [],
    sectionBodies: () => [],
    openQuestions: () => [],
    vars: { ...defaults, ...context.vars },
    head: () => context.head ?? "",
    start: () => context.start ?? "",
  })
  try {
    await fn()
  } finally {
    installContext(undefined)
  }
  if (captured === undefined) throw new Error("no step was issued")
  return captured
}
