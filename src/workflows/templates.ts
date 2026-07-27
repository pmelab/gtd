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
 * The repo-root-relative directory `gtd init` writes each agent state's prompt
 * into as a standalone, editable Markdown file (see `renderInitScaffold`). The
 * scaffolded `.gtdrc.json` references these via `./gtd-prompts/<state>.md`
 * content-value file references, which `compileWorkflowConfig` inlines at load
 * time (`resolveContent` in `src/PatternConfig.ts`) — so editing a prompt file
 * changes the workflow with no config edit.
 */
export const PROMPTS_DIR = "gtd-prompts"

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

/** One agent prompt `gtd init` writes out as a standalone Markdown file. */
export interface ScaffoldPromptFile {
  /** Repo-root-relative path, e.g. `gtd-prompts/grilling.md`. */
  readonly path: string
  /** The prompt body, verbatim from the bundled template's inline `prompt:`. */
  readonly content: string
}

/** The files `gtd init <name>` writes: the `.gtdrc.json` text plus one Markdown file per agent prompt. */
export interface InitScaffold {
  /** The `.gtdrc.json` contents, with each agent state's `prompt:` rewritten to a `./gtd-prompts/<state>.md` file reference. */
  readonly config: string
  /** The extracted prompt files, one per agent (`prompt:`) state, in declaration order. */
  readonly prompts: readonly ScaffoldPromptFile[]
}

/**
 * Render everything `gtd init <name>` writes. Like `renderInitConfig`, but each
 * agent state's inline `prompt:` is EXTRACTED into a standalone
 * `gtd-prompts/<state>.md` file and the config value is rewritten to a
 * `./gtd-prompts/<state>.md` file reference — `compileWorkflowConfig` inlines
 * it back at load time (`resolveContent`), so the workflow behaves identically
 * to the fully-inline `renderInitConfig` form while the prompts stay editable
 * as ordinary Markdown. Only `prompt:` content is externalized: human
 * `message:` blocks and check `script:` bodies remain inline in the config
 * (they are workflow mechanics, not prompts). The bundled YAML template itself
 * stays fully inline (it ships inside the single-file bundle); this function is
 * the only place the split happens, at scaffold time.
 */
export const renderInitScaffold = (name: WorkflowTemplateName): InitScaffold => {
  const workflow = parseYaml(WORKFLOW_TEMPLATES[name]) as {
    states?: Record<string, Record<string, unknown>>
  }
  const prompts: ScaffoldPromptFile[] = []
  for (const [stateName, state] of Object.entries(workflow.states ?? {})) {
    if (typeof state.prompt === "string") {
      const path = `${PROMPTS_DIR}/${stateName}.md`
      prompts.push({ path, content: state.prompt })
      state.prompt = `./${path}`
    }
  }
  const config = JSON.stringify({ $schema: SCHEMA_URL, workflow }, null, 2) + "\n"
  return { config, prompts }
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
