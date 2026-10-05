import { Effect } from "effect"
import { GtdUsageError, Narrator } from "../Commentary.js"
import { GitService, Host, Workspace } from "../platform/index.js"
import { ConfigDiscovery, ConfigService, multilineSetting, resolveVars } from "../workflow/index.js"
import { formatCommitMessage, formatSubject } from "../replay/index.js"
import type { WorkflowDefinition } from "../Workflow.js"
import type { LandStep } from "./LandStep.js"

/** Just enough of the current rest for `planEntry`'s checks. */
export interface EntryCurrent {
  readonly def: WorkflowDefinition
  /** The step the process rests at. */
  readonly state: string
  /** Whether no process is underway: the flow's first step, first visit. */
  readonly idle: boolean
  /** Why the flow will not open a process at this entry, or `undefined` when it will. */
  readonly entryRefusal: string | undefined
}

export type EntryOutcome =
  | { readonly kind: "refusal"; readonly message: string }
  | {
      readonly kind: "entry"
      readonly state: string
      readonly subject: string
      /** The `LandStep`s a driver runs to write the opening commit — data, never shell text. */
      readonly steps: readonly LandStep[]
    }

type Refused = Extract<EntryOutcome, { kind: "refusal" }>

const refusal = (message: string): Refused => ({ kind: "refusal", message })

const checkOverrides = (
  commandLabel: string,
  varOverrides: Record<string, string>,
  declaredNames: readonly string[],
  envNames: readonly string[],
): Effect.Effect<EntryOutcome | undefined, Error> =>
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
 * `gtd --entry <name>`: start a brand NEW process at a workflow entry, writing
 * an opening commit that carries every process setting as a `Gtd-Var:` trailer, plus a
 * `Gtd-Review-Base:` trailer when the entry fixes the process's diff base.
 * All validation is a REFUSAL, not an Effect failure.
 */
export const planEntry = (
  current: EntryCurrent,
  actor: string,
  entry: {
    readonly state: string
    readonly commandLabel: string
    readonly vars: Record<string, string>
  },
): Effect.Effect<
  EntryOutcome,
  Error,
  GitService | ConfigService | ConfigDiscovery | Workspace | Host | Narrator
> =>
  Effect.gen(function* () {
    const { state: name, commandLabel, vars: varOverrides } = entry

    if (!current.idle) {
      return refusal(
        `${commandLabel}: a process is already underway (resting at "${current.state}") — finish it, or run \`gtd abandon\`, before entering`,
      )
    }

    if (current.entryRefusal !== undefined) {
      return refusal(`${commandLabel}: ${current.entryRefusal}`)
    }

    const config = yield* (yield* ConfigService).load
    const declaredNames = Object.keys({ ...config.workflowVars, ...config.rcVars })
    const overrideRefusal = yield* checkOverrides(
      commandLabel,
      varOverrides,
      declaredNames,
      Object.keys({ ...config.workflowEnv, ...config.rcEnv }),
    )
    if (overrideRefusal !== undefined) return overrideRefusal

    let base: string | undefined
    const baseOf = current.def.base
    const vars = resolveVars(config.workflowVars, config.rcVars, varOverrides, (yield* Host).env)
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
    if (baseOf !== undefined && template !== undefined) {
      const resolved = yield* resolveBase(name, commandLabel, baseOf, template)
      if (typeof resolved !== "string") return resolved
      base = resolved
    }

    const subject = formatSubject(actor, name)
    const message = formatCommitMessage({
      actor,
      to: name,
      ...(base !== undefined ? { reviewBase: base } : {}),
      vars,
    })
    const steps: readonly LandStep[] = [
      { kind: "gitWrite", write: { kind: "commitAll", message } },
      { kind: "outcome", outcome: { kind: "commit", subject } },
    ]
    return { kind: "entry", state: name, subject, steps } as const
  })

/** The entry's diff base: a commitish that resolves, is an ancestor of HEAD, and is not HEAD. */
const resolveBase = (
  name: string,
  commandLabel: string,
  base: (entry: string, vars: Readonly<Record<string, string>>) => string | undefined,
  value: string,
): Effect.Effect<string | Refused, Error, GitService> =>
  Effect.gen(function* () {
    const rendered = value.trim()
    if (rendered === "") {
      return refusal(
        `${commandLabel}: "${name}"'s reviewBase template rendered blank — template: ${base.toString()}; pass the base with --var`,
      )
    }
    const git = yield* GitService
    const resolvedBase = yield* Effect.either(git.resolveRef(rendered))
    if (resolvedBase._tag === "Left") {
      return refusal(`${commandLabel}: "${rendered}" does not resolve to a commit`)
    }
    if (!(yield* git.isAncestor(resolvedBase.right, "HEAD"))) {
      return refusal(`${commandLabel}: "${rendered}" is not an ancestor of HEAD`)
    }
    if (resolvedBase.right === (yield* git.resolveRef("HEAD"))) {
      return refusal(`${commandLabel}: "${rendered}" is HEAD — nothing to review`)
    }
    return resolvedBase.right
  })
