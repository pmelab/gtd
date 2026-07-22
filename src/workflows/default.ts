import { parse as parseYaml } from "yaml"
import { compileWorkflowConfig } from "../PatternConfig.js"
import type { WorkflowDefinition } from "../PatternMachine.js"
import defaultYaml from "./default.yaml"

/**
 * The bundled default workflow, compiled through the exact same
 * `compileWorkflowConfig` a user's `.gtdrc` `workflow:` key goes through — no
 * privileged code path (see default.yaml's header comment for why every
 * content string there is inline rather than a `./`-relative file
 * reference). `default.yaml` is imported as raw text (tsdown's `.yaml` text
 * loader / the vitest `rawMd` transform — see tsdown.config.ts /
 * tests/vitest.rawMd.ts), so this module never touches the filesystem: it
 * works identically in the dev checkout, under `vitest`, and inside the
 * single-file `dist/gtd.bundle.mjs` build.
 *
 * `configDir` is passed as `"."` and never actually consulted: none of
 * default.yaml's content values start with `./`/`../`, so
 * `compileWorkflowConfig` never resolves a file reference against it.
 */
const compiled = compileWorkflowConfig(parseYaml(defaultYaml), ".")

export const defaultWorkflowDefinition: WorkflowDefinition = compiled.definition

/** The default workflow's own declared `vars:` defaults — `{ testCommand: "npm test" }`, overridable via a top-level `.gtdrc` `vars:` key or a `GTD_VAR_testCommand` environment variable (see `src/Edge.ts`'s `resolveVars`). */
export const defaultWorkflowVars: Record<string, string> = compiled.vars
