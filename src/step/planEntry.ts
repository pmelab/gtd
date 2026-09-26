import { Effect } from "effect"
import { Narrator } from "../Commentary.js"
import { GitService, Host, Workspace } from "../platform/index.js"
import { ConfigDiscovery, ConfigService } from "../workflow/index.js"
import { renderStateTemplate, varsOnlyContext } from "../PatternTemplates.js"
import {
  entryBaseTemplateOf,
  initialStateOf,
  manualEntryStates,
  stateSubject,
  type StateName,
  type WorkflowDefinition,
} from "../PatternMachine.js"
import type { LandStep } from "./LandStep.js"

/** Merge the four `it.vars` layers — same discipline as `Edge.ts`'s `resolveVars`, duplicated (not imported) so `src/step/` stays a leaf module Edge.ts depends on, never the reverse. */
const PREFIX = "GTD_"
const resolveVars = (
  workflowVars: Record<string, string>,
  rcVars: Record<string, string>,
  entryVars: Record<string, string>,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const merged = { ...workflowVars, ...rcVars, ...entryVars }
  for (const name of Object.keys(merged)) {
    const value = env[PREFIX + name.toUpperCase()]
    if (value !== undefined) merged[name] = value
  }
  return merged
}

const withEntryTrailers = (
  subject: string,
  opts: { base?: string; vars: Record<string, string> },
): string => {
  const lines: string[] = []
  if (opts.base !== undefined) lines.push(`Gtd-Review-Base: ${opts.base}`)
  for (const [name, value] of Object.entries(opts.vars)) lines.push(`Gtd-Var: ${name}=${value}`)
  return lines.length === 0 ? subject : `${subject}\n\n${lines.join("\n")}`
}

/** Just enough of the current rest for `planEntry`'s two checks — no guard/template machinery, unlike `RepoSnapshot`. */
export interface EntryCurrent {
  readonly def: WorkflowDefinition
  readonly state: StateName
}

export type EntryOutcome =
  | { readonly kind: "refusal"; readonly message: string }
  | {
      readonly kind: "entry"
      readonly state: StateName
      readonly subject: string
      /** The `LandStep`s a driver runs to write the entry commit — data, never shell text. */
      readonly steps: readonly LandStep[]
    }

/**
 * `gtd --entry <state>`: start a brand NEW process at `entry.state` — any
 * declared state — writing an ordinary turn commit carrying zero or more
 * `Gtd-Var:` trailers, plus (when `entry.state` declares a string
 * `reviewBase:`) a `Gtd-Review-Base:` trailer pinning the new process's diff
 * base. Unlike `planStep`, this still depends on `GitService` — resolving an
 * arbitrary `reviewBase:` template to a commit and checking ancestry is
 * inherently a live git question the entry state names only once this
 * function runs, so there is no snapshot value to freeze it into ahead of
 * time. All validation is a REFUSAL, not an Effect failure.
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
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const { state: entryState, commandLabel, vars: varOverrides } = entry

    if (current.state !== initialStateOf(current.def)) {
      return {
        kind: "refusal",
        message: `${commandLabel}: a process is already underway (resting at "${current.state}") — finish it, or run \`gtd abandon\`, before entering`,
      } as const
    }

    const enterable = manualEntryStates(current.def)
    if (!enterable.includes(entryState)) {
      return {
        kind: "refusal",
        message: `${commandLabel}: "${entryState}" is not an enterable state — enterable states:\n${enterable
          .map((s) => `  ${s}`)
          .join("\n")}`,
      } as const
    }

    const config = yield* (yield* ConfigService).load
    const declaredNames = Object.keys({ ...config.workflowVars, ...config.rcVars })
    const undeclared = Object.keys(varOverrides).filter((name) => !declaredNames.includes(name))
    if (undeclared.length > 0) {
      return {
        kind: "refusal",
        message: `${commandLabel}: --var name(s) not declared by this workflow: ${undeclared.join(
          ", ",
        )} — declared: ${declaredNames.length > 0 ? declaredNames.join(", ") : "(none)"}`,
      } as const
    }

    const host = yield* Host
    const vars = resolveVars(config.workflowVars, config.rcVars, varOverrides, host.env)

    let base: string | undefined
    const baseTemplate = entryBaseTemplateOf(current.def, entryState)
    if (baseTemplate !== undefined) {
      const git = yield* GitService
      const rendered = yield* Effect.try({
        try: () => renderStateTemplate(baseTemplate, varsOnlyContext(vars, entryState)),
        catch: (e) => new Error(`${commandLabel}: ${e instanceof Error ? e.message : String(e)}`),
      })
      if (rendered.trim() === "") {
        const refs = Array.from(
          new Set(Array.from(baseTemplate.matchAll(/it\.vars\.(\w+)/g)).map((m) => m[1]!)),
        )
        return {
          kind: "refusal",
          message: `${commandLabel}: "${entryState}"'s reviewBase template rendered blank — template: ${JSON.stringify(
            baseTemplate,
          )}; it.vars references: ${
            refs.length > 0 ? refs.map((r) => `it.vars.${r}`).join(", ") : "(none found)"
          }`,
        } as const
      }
      const resolvedBase = yield* Effect.either(git.resolveRef(rendered))
      if (resolvedBase._tag === "Left") {
        return {
          kind: "refusal",
          message: `${commandLabel}: "${rendered}" does not resolve to a commit`,
        } as const
      }
      const isBaseAncestor = yield* git.isAncestor(resolvedBase.right, "HEAD")
      if (!isBaseAncestor) {
        return {
          kind: "refusal",
          message: `${commandLabel}: "${rendered}" is not an ancestor of HEAD`,
        } as const
      }
      const headHash = yield* git.resolveRef("HEAD")
      if (resolvedBase.right === headHash) {
        return {
          kind: "refusal",
          message: `${commandLabel}: "${rendered}" is HEAD — nothing to review`,
        } as const
      }
      base = resolvedBase.right
    }

    const subject = stateSubject(actor, entryState)
    const message = withEntryTrailers(subject, {
      ...(base !== undefined ? { base } : {}),
      vars: varOverrides,
    })
    const steps: readonly LandStep[] = [
      { kind: "gitWrite", write: { kind: "commitAll", message } },
      { kind: "outcome", outcome: { kind: "commit", subject } },
    ]

    return { kind: "entry", state: entryState, subject, steps } as const
  })
