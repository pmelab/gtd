import { Effect, Option } from "effect"
import { GtdUsageError, Narrator } from "../Commentary.js"
import { GitService, Host, Workspace } from "../platform/index.js"
import {
  ConfigDiscovery,
  ConfigService,
  multilineSetting,
  resolveVars,
  type ResolvedWorkflow,
} from "../workflow/index.js"
import { formatCommitMessage, formatSubject } from "../replay/index.js"
import type { LandStep } from "./LandStep.js"

/** Just enough of the current rest for `planStart`'s checks. */
export interface StartCurrent {
  /** The step the process rests at. */
  readonly state: string
  /** Whether no process is underway: the default workflow's first step, first visit. */
  readonly idle: boolean
}

export type StartOutcome =
  | { readonly kind: "refusal"; readonly message: string }
  | {
      readonly kind: "start"
      readonly workflow: string
      readonly subject: string
      /** The `LandStep`s a driver runs to write the opening commit — data, never shell text. */
      readonly steps: readonly LandStep[]
    }

type Refused = Extract<StartOutcome, { kind: "refusal" }>

const refusal = (message: string): Refused => ({ kind: "refusal", message })

const checkOverrides = (
  commandLabel: string,
  varOverrides: Record<string, string>,
  declaredNames: readonly string[],
  envNames: readonly string[],
): Effect.Effect<StartOutcome | undefined, Error> =>
  Effect.gen(function* () {
    const environmentOnly = Object.keys(varOverrides).filter(
      (n) => !declaredNames.includes(n) && envNames.includes(n),
    )
    if (environmentOnly.length > 0) {
      return yield* Effect.fail(
        new GtdUsageError(
          `${commandLabel}: --var pins process settings only; ${environmentOnly.join(", ")} ${
            environmentOnly.length === 1 ? "is an environment setting" : "are environment settings"
          } — set it under "env:" in .gtdrc or with a GTD_<NAME> environment variable`,
        ),
      )
    }
    const undeclared = Object.keys(varOverrides).filter((n) => !declaredNames.includes(n))
    if (undeclared.length > 0) {
      return refusal(
        `${commandLabel}: --var name(s) not declared by this workflow: ${undeclared.join(
          ", ",
        )} — declared: ${declaredNames.length > 0 ? declaredNames.join(", ") : "(none)"}`,
      )
    }
    return undefined
  })

/**
 * `gtd --workflow <name>`: start a brand NEW process on a workflow, writing an
 * opening commit that names the workflow's first step and carries a
 * `Gtd-Workflow:` trailer, every process setting as a `Gtd-Var:` trailer, plus
 * a `Gtd-Review-Base:` trailer when the workflow fixes the process's diff base.
 * All validation is a REFUSAL, not an Effect failure.
 */
export const planStart = (
  current: StartCurrent,
  actor: string,
  start: {
    readonly workflow: ResolvedWorkflow
    /** The workflow's first step, or why it will not start a process. */
    readonly first: { readonly firstStep: string } | { readonly refusal: string }
    readonly commandLabel: string
    readonly vars: Record<string, string>
  },
): Effect.Effect<
  StartOutcome,
  Error,
  GitService | ConfigService | ConfigDiscovery | Workspace | Host | Narrator
> =>
  Effect.gen(function* () {
    const { workflow, first, commandLabel, vars: varOverrides } = start
    const name = workflow.name

    if (!current.idle) {
      return refusal(
        `${commandLabel}: a process is already underway (resting at "${current.state}") — finish it, or run \`gtd abandon\`, before starting another`,
      )
    }

    if ("refusal" in first) return refusal(`${commandLabel}: ${first.refusal}`)
    const { firstStep } = first

    const config = yield* (yield* ConfigService).load
    const declaredNames = Object.keys({ ...workflow.vars, ...config.rcVars })
    const overrideRefusal = yield* checkOverrides(
      commandLabel,
      varOverrides,
      declaredNames,
      Object.keys({ ...workflow.env, ...config.rcEnv }),
    )
    if (overrideRefusal !== undefined) return overrideRefusal

    const baseOf = workflow.def.base
    const vars = resolveVars(workflow.vars, config.rcVars, varOverrides, (yield* Host).env)
    const multiline = multilineSetting(vars)
    if (multiline !== undefined) {
      return refusal(
        `${commandLabel}: process setting "${multiline}" spans several lines — a process setting is pinned in a commit trailer and must be a single line`,
      )
    }
    const template = yield* Effect.try({
      try: () => baseOf?.(name, vars),
      catch: (e) => new Error(`${commandLabel}: ${e instanceof Error ? e.message : String(e)}`),
    })
    const base = template === undefined ? undefined : yield* resolveBase(commandLabel, template)
    if (typeof base === "object") return base

    const subject = formatSubject(actor, firstStep)
    const message = formatCommitMessage({
      actor,
      to: firstStep,
      workflow: name,
      ...(base !== undefined ? { reviewBase: base } : {}),
      vars,
    })
    const steps: readonly LandStep[] = [
      { kind: "gitWrite", write: { kind: "commitAll", message } },
      { kind: "outcome", outcome: { kind: "commit", subject } },
    ]
    return { kind: "start", workflow: name, subject, steps } as const
  })

/**
 * The workflow's diff base: `git merge-base <base> HEAD`, where a blank base
 * means the default branch. The merge-base is what gets pinned, so a base on
 * another branch reviews exactly this branch's own commits.
 */
const resolveBase = (
  commandLabel: string,
  value: string,
): Effect.Effect<string | Refused, Error, GitService> =>
  Effect.gen(function* () {
    const git = yield* GitService
    const rendered = value.trim()
    const target = rendered === "" ? yield* git.defaultBranch() : rendered
    const resolvedBase = yield* Effect.either(git.resolveRef(target))
    if (resolvedBase._tag === "Left") {
      return refusal(`${commandLabel}: "${target}" does not resolve to a commit`)
    }
    const mergeBase = yield* git.mergeBase(resolvedBase.right, "HEAD")
    if (Option.isNone(mergeBase)) {
      return refusal(`${commandLabel}: "${target}" shares no common ancestor with HEAD`)
    }
    if (mergeBase.value === (yield* git.resolveRef("HEAD"))) {
      return refusal(`${commandLabel}: nothing to review: HEAD has no commits beyond ${target}`)
    }
    return mergeBase.value
  })
