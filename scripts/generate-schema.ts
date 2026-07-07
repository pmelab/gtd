import { writeFileSync } from "node:fs"
import { JSONSchema } from "effect"
import { ConfigSchema } from "../src/Config.js"

const schema = JSONSchema.make(ConfigSchema)
writeFileSync("schema.json", JSON.stringify(schema, null, 2) + "\n")
