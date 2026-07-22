import { Schema } from "effect"

/**
 * v3's `.gtdrc` config shape: a single `workflow:` key (the whole machine
 * definition, compiled by `./PatternConfig.js`) — there are no other blessed
 * config keys (see `./Config.js`'s module docstring for why).
 *
 * Kept in its own module, separate from `./Config.js`, so `scripts/generate-
 * schema.ts` (run via `jiti`, a plain TS-via-Babel loader with no bundler-
 * style pluggable per-extension loaders) can import JUST the schema without
 * pulling in `./Config.js`'s chain to `./workflows/default.js` — which
 * imports `default.yaml` as raw text via tsdown's/vitest's `.yaml`-as-text
 * loader, something `jiti` has no equivalent for and doesn't need here: the
 * schema shape never depends on the bundled default workflow's content.
 */
export const ConfigSchema = Schema.Struct({
  // The whole machine shape, buildable from config: validated structurally by
  // the workflow compiler (`src/PatternConfig.ts`), not by effect/schema —
  // the shape is deep and recursive, and the compiler's errors carry rule
  // coordinates a flat schema error cannot.
  workflow: Schema.optional(Schema.Unknown),
})

export type DecodedConfig = Schema.Schema.Type<typeof ConfigSchema>
