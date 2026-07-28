import { parse as parseYaml } from "yaml"
import { compileWorkflowConfig, type CompiledWorkflowConfig } from "../PatternConfig.js"
import unifiedYaml from "./unified.yaml"

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
 * The top-level `modes:` block `gtd init` SEEDS into the scaffolded
 * `.gtdrc.json` as a ready-to-edit suggestion: a `format:` command for each
 * built-in steering-file mode the bundled template uses (`qa` for the plan /
 * open-questions files, `review` for REVIEW.md), so a fresh project's steering
 * files are auto-formatted with Prettier before gtd validates them. Only
 * `format:` is declared — gtd's built-in `qa`/`review` validators still do the
 * validating (the two halves layer independently — see STATES.md §12 /
 * docs/configuration.md `modes:`). gtd ships no formatter, so this is the one
 * place a default is suggested; a project edits or drops it freely (swap
 * Prettier for dprint, point at a script, delete the key).
 *
 * Seeded only by `renderInitScaffold` (the real `gtd init` write path), NOT by
 * `renderInitConfig`: the latter is reused as a hermetic test fixture (the
 * `Given the workflow` step) that must not depend on Prettier being installed
 * or spawn a subprocess at every steering-file gate.
 */
export const MODES_SUGGESTION = {
  qa: { format: "npx prettier --write <%= it.file %>" },
  review: { format: "npx prettier --write <%= it.file %>" },
} as const

/**
 * The single bundled workflow template `gtd init` scaffolds — the raw YAML text
 * of `unified.yaml`, imported as a string (tsdown's `.yaml` text loader / the
 * vitest `rawMd` transform — see tsdown.config.ts / tests/vitest.rawMd.ts), so
 * this module never touches the filesystem: it works identically in the dev
 * checkout, under `vitest`, and inside the single-file `dist/gtd.bundle.mjs`
 * build. gtd ships NO default workflow and no longer offers a choice of
 * templates — `gtd init` takes no argument.
 */
const UNIFIED_WORKFLOW = unifiedYaml

/**
 * Render the fully-inline BASE `.gtdrc.json` for the bundled template: a
 * `$schema` link (so editors pick up completion/validation) plus the template's
 * whole workflow object nested under a `workflow:` key — exactly the shape a
 * hand-authored `.gtdrc` `workflow:` value takes (`{ vars, states }`). The
 * template's multi-line prompts/scripts become `\n`-escaped JSON strings; the
 * config loader parses them back identically to the YAML source.
 *
 * This is NOT the exact file `gtd init` writes — the real write path
 * (`renderInitScaffold`) additionally externalizes agent prompts and seeds the
 * top-level `modes:` Prettier suggestion (`MODES_SUGGESTION`). This base form is
 * kept modes-free so it doubles as a hermetic test fixture (the
 * `Given the workflow` step) whose steering-file gates never shell out to
 * Prettier.
 */
export const renderInitConfig = (): string => {
  const workflow = parseYaml(UNIFIED_WORKFLOW) as unknown
  return JSON.stringify({ $schema: SCHEMA_URL, workflow }, null, 2) + "\n"
}

/** One agent prompt `gtd init` writes out as a standalone Markdown file. */
export interface ScaffoldPromptFile {
  /** Repo-root-relative path, e.g. `gtd-prompts/grilling.md`. */
  readonly path: string
  /** The prompt body, verbatim from the bundled template's inline `prompt:`. */
  readonly content: string
}

/** The files `gtd init` writes: the `.gtdrc.json` text plus one Markdown file per agent prompt. */
export interface InitScaffold {
  /** The `.gtdrc.json` contents, with each agent state's `prompt:` rewritten to a `./gtd-prompts/<state>.md` file reference and a top-level `modes:` Prettier suggestion seeded (see `MODES_SUGGESTION`). */
  readonly config: string
  /** The extracted prompt files, one per agent (`prompt:`) state, in declaration order. */
  readonly prompts: readonly ScaffoldPromptFile[]
}

/**
 * Render everything `gtd init` writes. Like `renderInitConfig`, but each agent
 * state's inline `prompt:` is EXTRACTED into a standalone
 * `gtd-prompts/<state>.md` file and the config value is rewritten to a
 * `./gtd-prompts/<state>.md` file reference — `compileWorkflowConfig` inlines
 * it back at load time (`resolveContent`), so the workflow behaves identically
 * to the fully-inline `renderInitConfig` form while the prompts stay editable
 * as ordinary Markdown. Only `prompt:` content is externalized: human
 * `message:` blocks, check `script:` bodies, and the `done` `commit:` template
 * remain inline in the config (they are workflow mechanics, not prompts). The
 * bundled YAML template itself stays fully inline (it ships inside the
 * single-file bundle); this function is the only place the split happens, at
 * scaffold time.
 *
 * It also seeds a top-level `modes:` block (`MODES_SUGGESTION`) — a ready-to-
 * edit Prettier `format:` for the built-in `qa`/`review` steering-file modes —
 * so a fresh project auto-formats its steering files out of the box. This lives
 * here rather than in `renderInitConfig` so the latter stays a hermetic test
 * fixture (see `MODES_SUGGESTION`).
 */
export const renderInitScaffold = (): InitScaffold => {
  const workflow = parseYaml(UNIFIED_WORKFLOW) as {
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
  const config =
    JSON.stringify({ $schema: SCHEMA_URL, modes: MODES_SUGGESTION, workflow }, null, 2) + "\n"
  return { config, prompts }
}

/**
 * Compile the bundled template through the same `compileWorkflowConfig` a
 * user's `.gtdrc` `workflow:` key goes through. Used only where a compiled
 * `WorkflowDefinition` is needed directly (Mermaid rendering, tests) — the
 * `gtd init` write path uses `renderInitScaffold` and never compiles.
 * `configDir` is `"."` and never consulted: no template content value starts
 * with `./`/`../`.
 */
export const compileTemplate = (): CompiledWorkflowConfig =>
  compileWorkflowConfig(parseYaml(UNIFIED_WORKFLOW), ".")
