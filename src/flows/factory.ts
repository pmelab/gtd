import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { Flow } from "./runtime.js"

// Registered, so a factory made by any copy of this file is recognised by the
// engine's copy — the same reason the replay context is.
const FACTORY = Symbol.for("@pmelab/gtd/workflow-factory")

export interface WorkflowBuild {
  readonly flow: Flow
  /** Process settings this workflow declares, over its file's `defaults` export. */
  readonly defaults?: Readonly<Record<string, string>> | undefined
  /** Environment settings this workflow declares, over its file's `envDefaults` export. */
  readonly envDefaults?: Readonly<Record<string, string>> | undefined
}

interface FactoryInternals {
  readonly schema: StandardSchemaV1
  readonly build: (options: never) => WorkflowBuild
}

/**
 * A factory call's result. Nothing is validated yet: gtd validates the options
 * when it loads the config, so a bad one is reported like any other config
 * finding instead of throwing out of `gtd.config.ts`.
 */
export interface ConfiguredWorkflow {
  readonly [FACTORY]: FactoryInternals & { readonly options: unknown }
  readonly then: () => never
}

export type WorkflowFactory<Options> = ({} extends Options
  ? (options?: Options) => ConfiguredWorkflow
  : (options: Options) => ConfiguredWorkflow) & { readonly [FACTORY]: FactoryInternals }

/**
 * Define a workflow configured by options. `schema` is any Standard Schema
 * (https://standardschema.dev); it should reject unknown keys, so a removed or
 * misspelled option fails at load. Exported from `gtd.config.ts`, the factory
 * itself and a call's result are both workflows.
 */
export const defineWorkflow = <S extends StandardSchemaV1>(
  schema: S,
  build: (options: StandardSchemaV1.InferOutput<S>) => WorkflowBuild,
): WorkflowFactory<StandardSchemaV1.InferInput<S>> => {
  const internals: FactoryInternals = { schema, build }
  const factory = (options?: unknown): ConfiguredWorkflow => ({
    [FACTORY]: { ...internals, options },
    // A factory call used to be a flow; awaiting one in a composed flow must fail, not no-op.
    // oxlint-disable-next-line unicorn/no-thenable -- awaiting a call must fail
    then: () => {
      throw new Error("a configured workflow is not a flow — compose fixFlow/reviewFlow instead")
    },
  })
  return Object.assign(factory, { [FACTORY]: internals }) as never
}

export interface OptionIssue {
  readonly path: readonly (string | number)[]
  readonly message: string
}

export type Configured =
  | { readonly ok: true; readonly build: WorkflowBuild }
  | { readonly ok: false; readonly issues: readonly OptionIssue[] }

const internalsOf = (
  value: unknown,
): (FactoryInternals & { readonly options?: unknown }) | undefined =>
  (typeof value === "function" || (typeof value === "object" && value !== null)) && FACTORY in value
    ? (value as { readonly [FACTORY]: FactoryInternals & { readonly options?: unknown } })[FACTORY]
    : undefined

export const isFactoryWorkflow = (value: unknown): boolean => internalsOf(value) !== undefined

const segment = (key: PropertyKey | StandardSchemaV1.PathSegment): string | number => {
  const raw = typeof key === "object" ? key.key : key
  return typeof raw === "number" ? raw : String(raw)
}

/**
 * Validate a factory workflow's options — those it was called with, `overrides`
 * on top — and build it. `undefined` for an export that is no factory workflow.
 */
export const configure = (
  value: unknown,
  overrides: Readonly<Record<string, unknown>> = {},
): Configured | undefined => {
  const internals = internalsOf(value)
  if (internals === undefined) return undefined
  const options = { ...(internals.options as object), ...overrides }
  const result = internals.schema["~standard"].validate(options)
  if (result instanceof Promise) {
    return {
      ok: false,
      issues: [
        {
          path: [],
          message: "the options schema validates asynchronously — gtd needs a synchronous one",
        },
      ],
    }
  }
  if (result.issues !== undefined) {
    return {
      ok: false,
      issues:
        result.issues.length === 0
          ? [{ path: [], message: "the options schema rejected them without saying why" }]
          : result.issues.map((issue) => ({
              path: (issue.path ?? []).map(segment),
              message: issue.message,
            })),
    }
  }
  return { ok: true, build: internals.build(result.value as never) }
}
