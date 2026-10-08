import {
  installContext,
  type CodeThreadInfo,
  type AccessDef,
  type FlowContext,
  type ScopeAccess,
  type StepRequest,
} from "../flows/index.js"
import { foldAccess } from "../replay/index.js"
import { access as bundledAccess } from "./access.js"
import { skills as bundledSkills } from "./skills.js"
import { defaults, envDefaults } from "./vars.js"

export interface TextContext {
  readonly vars?: Readonly<Record<string, string>>
  readonly env?: Readonly<Record<string, string>>
  readonly head?: string
  readonly start?: string
  readonly codeThreads?: readonly CodeThreadInfo[]
  readonly read?: (path: string) => string | undefined
  /** The scope the step runs in (`"build.review"`); the fixture pushes no scopes, so this stands in for the caller's. */
  readonly scope?: string
  /** Stands in for `.gtdrc` `skills:`, keyed by scope full name. */
  readonly skills?: Readonly<Record<string, readonly string[]>>
  /** Stands in for `.gtdrc` `access:`, keyed by scope full name. */
  readonly access?: Readonly<Record<string, ScopeAccess>>
}

const unavailable = (): never => {
  throw new Error("not available while rendering a text outside a replay")
}

/** Mirrors `Replay.ts`'s scope walk: for each prefix of the step's memory scope, innermost first, a `.gtdrc` entry, then the bundled export. */
const skillsForOf =
  (context: TextContext) =>
  (localName: string): readonly string[] => {
    const full = [context.scope, localName].filter((part) => part !== undefined && part !== "")
    const parts = full.join(".").split(".").slice(0, -1)
    const bundled = bundledSkills({ ...defaults, ...context.vars })
    for (let n = parts.length; n >= 0; n--) {
      const prefix = parts.slice(0, n).join(".")
      const hit = context.skills?.[prefix] ?? bundled[prefix]
      if (hit !== undefined) return hit
    }
    return []
  }

/** The same walk for access, folded the way `Replay.ts` folds it. */
const accessForOf =
  (context: TextContext) =>
  (localName: string, file?: string): AccessDef => {
    const full = [context.scope, localName].filter((part) => part !== undefined && part !== "")
    const parts = full.join(".").split(".").slice(0, -1)
    const bundled = bundledAccess({ ...defaults, ...context.vars })
    let hit: ScopeAccess | undefined
    for (let n = parts.length; n >= 0 && hit === undefined; n--) {
      const prefix = parts.slice(0, n).join(".")
      hit = context.access?.[prefix] ?? bundled[prefix]
    }
    return foldAccess(
      hit,
      file,
      (context.codeThreads ?? []).filter((t) => t.waitingOn === "agent").map((t) => t.path),
    )
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
  env: { ...envDefaults, ...context.env },
  head: () => context.head ?? "",
  start: () => context.start ?? "",
  skillsFor: skillsForOf(context),
  accessFor: accessForOf(context),
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
