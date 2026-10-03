import {
  installContext,
  type CodeThreadInfo,
  type FlowContext,
  type StepRequest,
} from "../flows/index.js"
import { defaults } from "./vars.js"

export interface TextContext {
  readonly vars?: Readonly<Record<string, string>>
  readonly head?: string
  readonly start?: string
  readonly codeThreads?: readonly CodeThreadInfo[]
  readonly read?: (path: string) => string | undefined
}

const unavailable = (): never => {
  throw new Error("not available while rendering a text outside a replay")
}

/** The fixed replay context texts render against; steps, refusals and scopes are unavailable unless overridden. */
export const fixtureContext = (
  context: TextContext = {},
  overrides: Partial<FlowContext> = {},
): FlowContext => ({
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
  threads: () => [],
  codeThreads: () => context.codeThreads ?? [],
  vars: { ...defaults, ...context.vars },
  head: () => context.head ?? "",
  start: () => context.start ?? "",
  ...overrides,
})

/** Evaluate one of the bundled workflow's texts the way replay would, against a fixed context. */
export const renderText = <T>(text: () => T, context: TextContext = {}): T => {
  installContext(fixtureContext(context))
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
  installContext(
    fixtureContext(context, {
      step: (request) => {
        captured = request
        return Promise.resolve()
      },
    }),
  )
  try {
    await fn()
  } finally {
    installContext(undefined)
  }
  if (captured === undefined) throw new Error("no step was issued")
  return captured
}
