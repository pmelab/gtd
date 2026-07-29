import { parse as parseYaml } from "yaml"
import { compileWorkflowConfig, type CompiledWorkflowConfig } from "../PatternConfig.js"
import type { WorkflowDefinition } from "../PatternMachine.js"
import unifiedYaml from "./unified.yaml"

/**
 * The `$schema` URL editors resolve for `.gtdrc.json` completion/validation —
 * written as the first key of every `gtd init` config (see `renderInitScaffold`).
 */
export const SCHEMA_URL = "https://raw.githubusercontent.com/pmelab/gtd/main/schema.json"

/**
 * The default `vars:` `gtd init` seeds into the scaffolded `.gtdrc.json` — the
 * one variable a fresh project almost always changes. It mirrors the bundled
 * workflow's OWN `testCommand` default (`npm test`), surfaced at the top level
 * as a ready-to-edit override (the top-level `vars:` layer wins over the
 * workflow's own — see `src/Edge.ts`'s `resolveVars`). Everything else the
 * workflow needs already ships inside the built-in default, so there is nothing
 * else to seed.
 */
export const INIT_VARS = {
  testCommand: "npm test",
} as const

/**
 * The top-level `modes:` block `gtd init` seeds into the scaffolded
 * `.gtdrc.json` as a ready-to-edit suggestion: a `format:` command for each
 * built-in steering-file mode the bundled default uses (`qa` for the plan /
 * open-questions files, `review` for REVIEW.md), so a fresh project's steering
 * files are auto-formatted with Prettier before gtd validates them. Only
 * `format:` is declared — gtd's built-in `qa`/`review` validators still do the
 * validating (the two halves layer independently — see STATES.md §12 /
 * docs/configuration.md `modes:`). gtd ships no formatter, so this is the one
 * place a default is suggested; a project edits or drops it freely (swap
 * Prettier for dprint, point at a script, delete the key).
 */
export const MODES_SUGGESTION = {
  qa: { format: "npx prettier --write <%= it.file %>" },
  review: { format: "npx prettier --write <%= it.file %>" },
} as const

/**
 * The single bundled workflow template — the raw YAML text of `unified.yaml`,
 * imported as a string (tsdown's `.yaml` text loader / the vitest `rawMd`
 * transform — see tsdown.config.ts / tests/vitest.rawMd.ts), so this module
 * never touches the filesystem: it works identically in the dev checkout,
 * under `vitest`, and inside the single-file `dist/gtd.bundle.mjs` build. gtd
 * ships this as its BUILT-IN DEFAULT — a repo with no `workflow:` configured
 * runs it directly (see `src/Config.ts`'s `toOperations`), so `gtd init` no
 * longer writes the workflow into the config at all.
 */
const UNIFIED_WORKFLOW = unifiedYaml

/**
 * The bundled default, compiled once through the exact same
 * `compileWorkflowConfig` a user's `.gtdrc` `workflow:` key goes through — no
 * privileged code path. `src/Config.ts` (and the in-memory test layer) fall
 * back to this whenever no `workflow:` key is configured; `compileTemplate`
 * exposes it fresh for Mermaid rendering and tests. `configDir` is `"."` and
 * never consulted: no template content value starts with `./`/`../`.
 */
const DEFAULT_WORKFLOW: CompiledWorkflowConfig = compileWorkflowConfig(
  parseYaml(UNIFIED_WORKFLOW),
  ".",
)

/** The compiled built-in default workflow definition — the fallback when no `workflow:` is configured. */
export const defaultWorkflowDefinition: WorkflowDefinition = DEFAULT_WORKFLOW.definition

/** The built-in default workflow's own declared `vars:` defaults (layer 1 of the merged `it.vars`). */
export const defaultWorkflowVars: Record<string, string> = DEFAULT_WORKFLOW.vars

/**
 * Render the full built-in workflow as a `.gtdrc.json` `workflow:` value — the
 * template's whole workflow object nested under a `workflow:` key, exactly the
 * shape a hand-authored `.gtdrc` `workflow:` value takes (`{ vars, states }`),
 * plus a `$schema` link. This is NOT what `gtd init` writes (init seeds only
 * vars/modes — the workflow itself is built in); it is kept as the way to
 * MATERIALIZE the default for editing, and as the hermetic `Given the workflow`
 * test fixture (modes-free, so its steering-file gates never shell out to
 * Prettier).
 */
export const renderInitConfig = (): string => {
  const workflow = parseYaml(UNIFIED_WORKFLOW) as unknown
  return JSON.stringify({ $schema: SCHEMA_URL, workflow }, null, 2) + "\n"
}

/** The single file `gtd init` writes: the `.gtdrc.json` contents. */
export interface InitScaffold {
  /** The `.gtdrc.json` contents — a `$schema` link plus the seeded default `vars:` and `modes:`; NO `workflow:` (the default is built in). */
  readonly config: string
}

/**
 * Render what `gtd init` writes: a minimal `.gtdrc.json` seeding the default
 * variables (`vars.testCommand`) and a ready-to-edit Prettier formatting
 * suggestion (`modes:`). It carries NO `workflow:` key — gtd ships the unified
 * workflow as its built-in default and runs it whenever none is configured
 * (see `src/Config.ts`). A project that wants to customize the machine itself
 * adds a `workflow:` key (materialize the default with `renderInitConfig` as a
 * starting point); everyday tuning is just editing the seeded `vars:`/`modes:`.
 */
export const renderInitScaffold = (): InitScaffold => {
  const config =
    JSON.stringify({ $schema: SCHEMA_URL, vars: INIT_VARS, modes: MODES_SUGGESTION }, null, 2) +
    "\n"
  return { config }
}

/**
 * Compile the bundled template through the same `compileWorkflowConfig` a
 * user's `.gtdrc` `workflow:` key goes through. Used where a freshly-compiled
 * `WorkflowDefinition` is needed directly (Mermaid rendering, tests).
 * `configDir` is `"."` and never consulted: no template content value starts
 * with `./`/`../`.
 */
export const compileTemplate = (): CompiledWorkflowConfig =>
  compileWorkflowConfig(parseYaml(UNIFIED_WORKFLOW), ".")
