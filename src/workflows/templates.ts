import { parse as parseYaml } from "yaml"
import { compileWorkflowConfig, type CompiledWorkflowConfig } from "../PatternConfig.js"
import type { WorkflowDefinition } from "../PatternMachine.js"
import type { MachineNode } from "../Machines.js"
import unifiedYaml from "./unified.yaml"

// Unversioned on purpose: gtd init writes this into a config the project
// commits, and a schema that tracks the installed CLI ages better than a pin
// that silently goes stale. Pin a major (`@pmelab/gtd@8`) in `.gtdrc` by hand
// for the opposite trade.
export const SCHEMA_URL = "https://cdn.jsdelivr.net/npm/@pmelab/gtd/schema.json"

// Mirrors the bundled workflow's own `testCommand` default, surfaced at the
// top level as a ready-to-edit override (the top-level `vars:` layer wins —
// see `src/Edge.ts`'s `resolveVars`).
export const INIT_VARS = {
  testCommand: "npm test",
} as const

// gtd ships no formatter, so this is the one place a default is suggested;
// only `format:` is seeded, since the built-in `qa`/`review` validators
// already do the validating.
export const MODES_SUGGESTION = {
  qa: { format: "npx prettier --write <%= it.file %>" },
  review: { format: "npx prettier --write <%= it.file %>" },
} as const

const UNIFIED_WORKFLOW = unifiedYaml

// `configDir` is `"."` and never consulted: every template value is already
// inline (required for the single-file bundle), so none starts with
// `./`/`../` that would need resolving against it.
const DEFAULT_WORKFLOW: CompiledWorkflowConfig = compileWorkflowConfig(
  parseYaml(UNIFIED_WORKFLOW),
  ".",
)

export const defaultWorkflowDefinition: WorkflowDefinition = DEFAULT_WORKFLOW.definition

/** Machine-instance tree for tooling that needs the grouping the flattened `WorkflowDefinition` loses (e.g. `gtd visualize`). */
export const defaultMachineTree: MachineNode = DEFAULT_WORKFLOW.tree

/** Qualified state name -> owning machine-instance path. */
export const defaultStateScopes: Record<string, string> = DEFAULT_WORKFLOW.scopes

export const defaultWorkflowVars: Record<string, string> = DEFAULT_WORKFLOW.vars

// Not what `gtd init` writes (init seeds only vars/modes); this materializes
// the default for editing, and doubles as the hermetic `Given the workflow`
// test fixture (modes-free, so its steering-file gates never shell to
// Prettier).
export const renderInitConfig = (): string => {
  const workflow = parseYaml(UNIFIED_WORKFLOW)
  return JSON.stringify({ $schema: SCHEMA_URL, workflow }, null, 2) + "\n"
}

export interface InitScaffold {
  readonly config: string
}

export const renderInitScaffold = (): InitScaffold => {
  const config =
    JSON.stringify({ $schema: SCHEMA_URL, vars: INIT_VARS, modes: MODES_SUGGESTION }, null, 2) +
    "\n"
  return { config }
}

export const compileTemplate = (): CompiledWorkflowConfig =>
  compileWorkflowConfig(parseYaml(UNIFIED_WORKFLOW), ".")
