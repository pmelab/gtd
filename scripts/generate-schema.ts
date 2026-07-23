import { writeFileSync } from "node:fs"
import { JSONSchema } from "effect"
// Imported from ../src/ConfigSchema.js (NOT ../src/Config.js): Config.ts's
// module chain reaches ./workflows/default.js, which imports default.yaml as
// raw text via tsdown's/vitest's `.yaml`-as-text loader — something `jiti`
// (this script's runner) has no equivalent for and doesn't need: the schema
// shape never depends on the bundled default workflow's content.
import { ConfigSchema } from "../src/ConfigSchema.js"

const schema = JSONSchema.make(ConfigSchema) as Record<string, unknown> & {
  properties: Record<string, unknown>
}

// `$schema` is a blessed no-op key at runtime (Config.ts strips it before
// validation, and gtd's own `.gtdrc` stub writes one) — declare it here too,
// or editors validating a JSON `.gtdrc` against this schema would flag the
// very stub gtd generates (the top level is additionalProperties: false).
schema.properties["$schema"] = {
  type: "string",
  description: "Editor-only pointer at this schema. Stripped by gtd before validation.",
}

writeFileSync("schema.json", JSON.stringify(schema, null, 2) + "\n")
