import { parse as parseYaml } from "yaml"
import { compileWorkflowConfig, type CompiledWorkflowConfig } from "../PatternConfig.js"
import advancedYaml from "./advanced.yaml"
import simpleYaml from "./simple.yaml"

/**
 * The `$schema` URL editors resolve for `.gtdrc.json` completion/validation —
 * written as the first key of every `gtd init` config (see `renderInitConfig`).
 */
export const SCHEMA_URL = "https://raw.githubusercontent.com/pmelab/gtd/main/schema.json"

/**
 * The bundled workflow templates `gtd init <name>` can scaffold, keyed by the
 * name the user passes. Each value is the raw YAML text of the template file,
 * imported as a string (tsdown's `.yaml` text loader / the vitest `rawMd`
 * transform — see tsdown.config.ts / tests/vitest.rawMd.ts), so this module
 * never touches the filesystem: it works identically in the dev checkout,
 * under `vitest`, and inside the single-file `dist/gtd.bundle.mjs` build.
 */
const WORKFLOW_TEMPLATES = {
  simple: simpleYaml,
  advanced: advancedYaml,
} as const

export type WorkflowTemplateName = keyof typeof WORKFLOW_TEMPLATES

/** The template names as a plain array, for usage messages and validation. */
export const WORKFLOW_TEMPLATE_NAMES = Object.keys(WORKFLOW_TEMPLATES) as WorkflowTemplateName[]

export const isWorkflowTemplateName = (name: string): name is WorkflowTemplateName =>
  Object.prototype.hasOwnProperty.call(WORKFLOW_TEMPLATES, name)

/**
 * Render the `.gtdrc.json` `gtd init <name>` writes: a `$schema` link (so
 * editors pick up completion/validation) plus the template's whole workflow
 * object nested under a `workflow:` key — exactly the shape a hand-authored
 * `.gtdrc` `workflow:` value takes (`{ vars, states }`). The template's
 * multi-line prompts/scripts become `\n`-escaped JSON strings; the config
 * loader parses them back identically to the YAML source.
 */
export const renderInitConfig = (name: WorkflowTemplateName): string => {
  const workflow = parseYaml(WORKFLOW_TEMPLATES[name]) as unknown
  return JSON.stringify({ $schema: SCHEMA_URL, workflow }, null, 2) + "\n"
}

/**
 * Compile a bundled template through the same `compileWorkflowConfig` a
 * user's `.gtdrc` `workflow:` key goes through. Used only where a compiled
 * `WorkflowDefinition` is needed directly (Mermaid rendering, tests) — the
 * `gtd init` write path uses `renderInitConfig` and never compiles.
 * `configDir` is `"."` and never consulted: no template content value starts
 * with `./`/`../`.
 */
export const compileTemplate = (name: WorkflowTemplateName): CompiledWorkflowConfig =>
  compileWorkflowConfig(parseYaml(WORKFLOW_TEMPLATES[name]), ".")
