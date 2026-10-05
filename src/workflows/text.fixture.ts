import {
  installContext,
  type CodeThreadInfo,
  type FlowContext,
  type StepRequest,
} from "../flows/index.js"
import { skills as bundledSkills } from "./skills.js"
import { defaults, envDefaults } from "./vars.js"

export interface TextContext {
  readonly vars?: Readonly<Record<string, string>>
  readonly env?: Readonly<Record<string, string>>
  readonly head?: string
  readonly start?: string
  readonly codeThreads?: readonly CodeThreadInfo[]
  readonly read?: (path: string) => string | undefined
  /**
   * A PER-KEY `skillsFor` override, keyed by the LOCAL name a bundled step
   * calls itself with (`captureStep`/`renderText` push no scopes, so a local
   * name is also the only name here) — stands in for a `.gtdrc` entry, so
   * only the key it names is overridden; every other step still falls back
   * to the call's own `skills` option, then the bundled map (`./skills.ts`),
   * so an existing step test keeps its skills without having to declare them
   * itself.
   */
  readonly skills?: Readonly<Record<string, readonly string[]>>
}

const unavailable = (): never => {
  throw new Error("not available while rendering a text outside a replay")
}

/** The bundled map is keyed by FULL name, but a bundled step calls itself by its own LOCAL name and this fixture pushes no scope to prefix it with — so the default lookup matches on the local name alone, or as the last `.`-separated segment of a bundled key. `health.describe`'s two bundled entries (`packages.item.health.describe`, `build.health.describe`) share one list, so the ambiguity this leaves resolves to the same answer either way. */
const bundledSkillsFor = (localName: string): readonly string[] => {
  const exact = bundledSkills[localName]
  if (exact !== undefined) return exact
  const suffix = `.${localName}`
  const hit = Object.entries(bundledSkills).find(([key]) => key.endsWith(suffix))
  return hit?.[1] ?? []
}

/**
 * Mirrors `Replay.ts`'s `resolveSkills` three-way precedence: `context.skills`
 * (a per-key override, standing in for `.gtdrc`) beats `ownSkills` (a call's
 * own `skills` option), which beats the bundled default — so a step test that
 * passes its own `skills` option (like `reviewQuality`'s lens) sees it in the
 * preamble too, the same as a real replay would.
 */
const skillsForOf =
  (context: TextContext) =>
  (localName: string, ownSkills?: readonly string[]): readonly string[] => {
    const configured = context.skills?.[localName]
    if (configured !== undefined) return configured
    return ownSkills ?? bundledSkillsFor(localName)
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
