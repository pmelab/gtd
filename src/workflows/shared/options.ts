import { Schema } from "effect"
import {
  defineWorkflow,
  type Flow,
  type WorkflowBase,
  type WorkflowDoors,
  type WorkflowFactory,
} from "../../flows/index.js"
import { defaults, envDefaults } from "./vars.js"

const setting = Schema.optionalWith(Schema.String, { exact: true })

export const ShippedOptions = Schema.Struct({
  reviewBase: setting,
  judgeBudgetBytes: setting,
  judgeIdenticalMinP: setting,
  reviewNoteActionable: setting,
  qualityReviews: setting,
  testCommand: setting,
  fastTestCommand: setting,
  plannerModel: setting,
  coderModel: setting,
})

export type ShippedOptions = Schema.Schema.Encoded<typeof ShippedOptions>

const over = (
  base: Readonly<Record<string, string>>,
  options: Readonly<Record<string, string>>,
): Record<string, string> => ({
  ...base,
  ...Object.fromEntries(Object.entries(options).filter(([name]) => Object.hasOwn(base, name))),
})

/** A shipped flow as a factory: its options override the settings it declares, each in its own kind. */
export const shipped = (
  flow: Flow,
  doors?: WorkflowDoors,
  base?: WorkflowBase,
): WorkflowFactory<ShippedOptions> =>
  defineWorkflow(
    Schema.standardSchemaV1(ShippedOptions, { onExcessProperty: "error", errors: "all" }),
    (options) => ({
      flow,
      defaults: over(defaults, options),
      envDefaults: over(envDefaults, options),
      doors,
      base,
    }),
  )
