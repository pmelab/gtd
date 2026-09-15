/**
 * The workflow-compilation boundary. Three capabilities, each with the
 * companion exports a caller actually needs to use it — nothing beyond that:
 *
 * - **compile** — `compileWorkflow`, sync/total, never reads a file itself
 *   (it reads only through the `WorkflowFiles` port a caller injects).
 * - **load** — `load` (the effectful pipeline) plus `ConfigService` (the
 *   `Context.Tag` CLI/LSP/tests all provide it through), `ConfigDiscovery`
 *   (the companion `Context.Tag` a caller providing `ConfigService.Live`
 *   must also provide — `.Live` for production real disk via cosmiconfig,
 *   an in-memory fake for tests, see `src/testing/Layers.ts`), and
 *   `configPresentAt` (`gtd init`'s narrower "is there a config already"
 *   check over the same `ConfigDiscovery`).
 * - **schema** — stays on `src/ConfigSchema.ts` directly, NOT re-exported
 *   here: its one real consumer, `scripts/generate-schema.ts`, cannot go
 *   through this barrel — importing anything from it drags in
 *   `compileWorkflow`'s own module chain (`../workflows/index.js`,
 *   which loads `unified.yaml` as text through a loader `generate-schema.ts`'s
 *   `jiti` runner can't run). A re-export with no importer is worse than no
 *   re-export.
 *
 * `SEARCH_PLACES`/`walkUp` are exported too, ONLY so `src/testing/Layers.ts`'s
 * in-memory `ConfigDiscovery` counterpart shares the exact candidate list and
 * directory walk `discovery.ts`'s real, cosmiconfig-backed one uses, rather
 * than an independent copy that could silently drift.
 *
 * `formatDiagnostic` and the `Diagnostic` type round out the shape every one
 * of the above produces or consumes; both have real external consumers
 * (`src/program.ts`, `src/Machines.ts`/`src/PatternConfig.ts`).
 *
 * `renderInitScaffold` is re-exported from `../workflows/index.js` (the
 * bundled-template data directory's own barrel, not this module's own files)
 * so `src/program.ts` reaches it through a barrel instead of a bare relative
 * import into `workflows/`'s internals.
 */
export { compileWorkflow } from "./compile.js"
export { load, ConfigService, configPresentAt } from "./load.js"
export { ConfigDiscovery, SEARCH_PLACES, walkUp } from "./discovery.js"
export { formatDiagnostic } from "./Diagnostic.js"
export type { Diagnostic } from "./Diagnostic.js"
export { renderInitScaffold } from "../workflows/index.js"
