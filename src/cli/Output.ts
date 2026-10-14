import { Effect } from "effect"
import { CommandRunner, GitService, Host, Narrator, Workspace } from "../platform/index.js"
import { selectPath } from "../wire/index.js"
import { ConfigDiscovery, ConfigService } from "../workflow/index.js"
import type { ToolCommands } from "./ToolCommands.js"

/**
 * A command-level failure that should exit like a CLI usage error (2), not a
 * generic runtime failure (1): an unknown `--json=<path>` selector, or a
 * `gtd judge answer` verdict that fails to decode — malformed JSON on stdin,
 * or one naming a question id the pending judgment never asked. Both are
 * caller-input errors per `docs/cli.md`'s exit-code table, not a refusal
 * about the resolved rest's own state.
 */
export class SelectorUsageError extends Error {}

/** The `--json=<path>` select branch, shared by the emitting commands so none drift on the unknown-selector message. `absent` writes nothing and lets the caller's success path continue. */
export const writeSelection = (
  out: ArtifactOut,
  fields: unknown,
  path: string,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const selection = selectPath(fields, path)
    if (selection.kind === "value") {
      out.write(`${selection.text}\n`)
    } else if (selection.kind === "unknown") {
      return yield* Effect.fail(
        new SelectorUsageError(
          `gtd: unknown --json selector "${selection.path}" — see \`gtd --help\``,
        ),
      )
    }
  })

/**
 * `--json`'s three shapes: absent, bare (the whole document), or `--json=<path>`
 * (one reduced value). See `src/wire/Select.ts` for how `select` is later resolved.
 */
export type JsonMode =
  | { readonly kind: "off" }
  | { readonly kind: "document" }
  | { readonly kind: "select"; readonly path: string }

/**
 * The all-or-nothing stdout buffer every `run*Command` handler writes
 * through instead of `io.stdout` directly. `flush()` is called exactly once,
 * by `runCli`, after the command's Effect succeeds; on any failure `flush()`
 * is never reached, so the buffer is simply discarded and nothing reaches
 * `io.stdout`. `ui` is the one handler that calls `flush()` itself,
 * ahead of blocking on `Effect.never` — since it blocks forever, `runCli`'s
 * own flush-on-success would otherwise never fire and its output would never
 * reach stdout.
 */
export interface ArtifactOut {
  readonly write: (chunk: string) => void
  readonly flush: () => void
}

export type CommandRequirements =
  | GitService
  | ConfigService
  | ConfigDiscovery
  | Workspace
  | Host
  | Narrator
  | CommandRunner
  | ToolCommands
