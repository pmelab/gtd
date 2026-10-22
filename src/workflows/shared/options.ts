import { Schema } from "effect"
import {
  defineWorkflow,
  type Flow,
  type WorkflowBase,
  type WorkflowDoors,
  type WorkflowFactory,
  refuse,
  scope,
  vars,
} from "../../flows/index.js"
import { defaultFlagRegistry, defaults, envDefaults } from "./vars.js"

const setting = Schema.optionalWith(Schema.String, { exact: true })

export const ShippedOptions = Schema.Struct({
  reviewBase: setting,
  judgeBudgetBytes: setting,
  judgeIdenticalMinP: setting,
  reviewNoteActionable: setting,
  reviewSeverityMinP: setting,
  qualityTriageMinP: setting,
  standardMinP: setting,
  refactorFlagPattern: setting,
  seamAllow: setting,
  sliceMaxCriteria: setting,
  qualityReviews: setting,
  refactorQualityReviews: setting,
  continuations: setting,
  continuationStall: setting,
  testCommand: setting,
  plannerModel: setting,
  coderModel: setting,
  flagMode: Schema.optionalWith(Schema.Boolean, { exact: true }),
  contextLimit: Schema.optionalWith(
    Schema.Struct({
      soft: Schema.optionalWith(Schema.Number, { exact: true }),
      hard: Schema.optionalWith(Schema.Number, { exact: true }),
    }),
    { exact: true },
  ),
})

export type ShippedOptions = Schema.Schema.Encoded<typeof ShippedOptions>

const over = (
  base: Readonly<Record<string, string>>,
  options: Readonly<Record<string, string | boolean>>,
): Record<string, string> => ({
  ...base,
  ...Object.fromEntries(
    Object.entries(options)
      .filter(([name]) => Object.hasOwn(base, name))
      .map(([name, value]) => [name, String(value)]),
  ),
})

/** The `flagMode` setting, pinned at process start. Anything but true/false fails rather than guess a side. */
export const flagModeOn = (): boolean => {
  const value = vars.flagMode ?? defaults.flagMode!
  if (value !== "true" && value !== "false")
    refuse(`gtd: flagMode must be "true" or "false", got ${JSON.stringify(value)}`)
  return value === "true"
}

// Not a setting: a factory option is known at load, so the scope wraps the
// whole flow without reading a setting before its first step. The engine
// refuses limits it cannot use when it reaches an agent step.
const limited = (flow: Flow, context: ShippedOptions["contextLimit"]): Flow =>
  context === undefined ? flow : () => scope({ context }, flow)

/** A shipped flow as a factory: its options override the settings it declares, each in its own kind. */
export const shipped = (
  flow: Flow,
  doors?: WorkflowDoors,
  base?: WorkflowBase,
): WorkflowFactory<ShippedOptions> =>
  defineWorkflow(
    Schema.standardSchemaV1(ShippedOptions, { onExcessProperty: "error", errors: "all" }),
    ({ contextLimit, ...options }) => ({
      flow: limited(flow, contextLimit),
      defaults: over(defaults, options),
      envDefaults: over(envDefaults, options),
      doors,
      base,
    }),
  )

export const FlagOptions = Schema.Struct({ ...ShippedOptions.fields, flagRegistry: setting })

export type FlagOptions = Schema.Schema.Encoded<typeof FlagOptions>

export const flagShipped = (
  flow: Flow,
  name: "rollout" | "cleanup",
): WorkflowFactory<FlagOptions> =>
  defineWorkflow(
    Schema.standardSchemaV1(FlagOptions, { onExcessProperty: "error", errors: "all" }),
    ({ contextLimit, ...options }) => {
      const flagDefaults = { ...defaults, flag: "", flagRegistry: defaultFlagRegistry }
      return {
        flow: limited(flow, contextLimit),
        defaults: over(flagDefaults, options),
        envDefaults: over(envDefaults, options),
        doors: { [name]: { args: [{ name: "flag" }], vars: ({ flag }) => ({ flag: flag ?? "" }) } },
        base: undefined,
      }
    },
  )
