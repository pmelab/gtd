import { writeFileSync } from "node:fs"
import { JSONSchema } from "effect"
import { ConfigSchema } from "../src/ConfigSchema.js"

const schema = JSONSchema.make(ConfigSchema) as Record<string, unknown> & {
  properties: Record<string, unknown>
}

// `$schema` is stripped by `src/workflow/load.ts` before validation, but the
// top level is additionalProperties: false — declare it here too, or editors
// would flag gtd's own `.gtdrc` stub.
schema.properties["$schema"] = {
  type: "string",
  description: "Editor-only pointer at this schema. Stripped by gtd before validation.",
}

writeFileSync("schema.json", JSON.stringify(schema, null, 2) + "\n")
