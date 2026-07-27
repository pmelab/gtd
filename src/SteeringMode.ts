import { FileSystem } from "@effect/platform"
import { Effect } from "effect"
import { spawnSync } from "node:child_process"
import { formatFile } from "./Format.js"
import { parseOpenQuestions } from "./OpenQuestions.js"
import { parseReviewDoc } from "./ReviewDoc.js"
import {
  isBuiltInMode,
  knownModes,
  type BuiltInMode,
  type ModeDef,
  type StateMode,
  type WorkflowDefinition,
} from "./PatternMachine.js"
import { renderModeCommand, type TemplateContext } from "./PatternTemplates.js"

/**
 * The steering-file MODE edge: resolving a state's `mode:` to a format/validate
 * pair and performing it (see STATES.md §12 and
 * `docs/design/pluggable-steering-modes.md`).
 *
 * A mode is a pair of operations over ONE file:
 *
 * 1. **format** — rewrite the file in place, so whatever a human or an agent
 *    just wrote is normalized before anything judges it.
 * 2. **validate** — report findings (zero findings = valid).
 *
 * Two mode names are implemented HERE, in process (`PatternMachine`'s
 * `BUILT_IN_MODES`): `qa` and `review` format with the markdown formatter
 * behind `gtd format` and validate with the canonical pure parsers
 * (`src/OpenQuestions.ts` / `src/ReviewDoc.ts`) — the same parsers `gtd lsp`
 * publishes as live diagnostics, which is why they stay in process rather than
 * becoming shell-outs.
 *
 * Every OTHER mode is workflow-declared DATA: a `modes:` entry naming a shell
 * command for either half (`PatternMachine.ModeDef`), rendered as an Eta
 * template with `it.file` bound to the rendered steering-file path and executed
 * verbatim via `bash -c`. The contract is the shell's own: for `validate`,
 * exit 0 means valid and a non-zero exit means invalid with its output (stdout
 * then stderr) as the findings; for `format`, a non-zero exit is a hard error
 * (broken tooling, not a malformed file). A `modes:` entry that reuses a
 * built-in name REPLACES it wholesale, so a mode declaring only `validate:`
 * has no formatting step at all.
 *
 * gtd interprets NOTHING about a command beyond its exit code and output —
 * same discipline as the scripted check actor (`gtd run`), and the second (and
 * last) place gtd spawns a subprocess.
 */

/** A state's `mode:` resolved against the active definition: gtd's own in-process implementation, or the workflow's declared commands. */
export type ResolvedMode =
  | { readonly kind: "builtin"; readonly mode: BuiltInMode }
  | {
      readonly kind: "commands"
      readonly mode: StateMode
      readonly commands: ModeDef
    }

/**
 * Resolve a `mode:` name: a `modes:` entry wins (so a workflow can replace a
 * built-in), then the two built-ins. `undefined` for a name nothing defines —
 * `validateDefinition` rejects that at load time, so the edge only ever sees it
 * as a defensive case.
 */
export const resolveSteeringMode = (
  def: WorkflowDefinition,
  mode: StateMode,
): ResolvedMode | undefined => {
  const declared = def.modes?.[mode]
  if (declared !== undefined) return { kind: "commands", mode, commands: declared }
  if (isBuiltInMode(mode)) return { kind: "builtin", mode }
  return undefined
}

/** The error message for a `mode:` that resolves to nothing — lists what the active workflow does know. */
export const unknownModeMessage = (
  def: WorkflowDefinition,
  state: string,
  mode: StateMode,
): string =>
  `state "${state}": mode "${mode}" is not defined by the active workflow (known modes: ${knownModes(def).join(", ")})`

/** Only these extensions get the built-in markdown formatter — a `qa`/`review` steering file that isn't markdown is validated but never rewritten. */
const MARKDOWN_STEERING_RE = /\.(?:md|markdown)$/i

/** One command run's outcome: its exit status (a signal death reported as `null`) and its combined output (stdout then stderr). */
interface CommandOutcome {
  readonly status: number | null
  readonly output: string
}

/**
 * Run one rendered mode command through `bash -c` in `cwd`, capturing output
 * instead of inheriting the terminal (unlike `gtd run`'s scripted actor, whose
 * output IS the point): here the output is data — a validate command's findings
 * are reported to the agent that must fix them. A spawn failure (no `bash`, an
 * unreadable cwd) fails the Effect; a non-zero EXIT is a value, since that is
 * the mode's way of saying "invalid".
 */
const runCommand = (command: string, cwd: string): Effect.Effect<CommandOutcome, Error> =>
  Effect.try({
    try: () => {
      const result = spawnSync("bash", ["-c", command], {
        cwd,
        encoding: "utf8",
      })
      if (result.error !== undefined) throw result.error
      return {
        status: result.status,
        output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
      }
    },
    catch: (e) => new Error(`command "${command}" could not be run: ${errorText(e)}`),
  })

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Render one command template, turning an Eta failure into a named error rather than executing anything. */
const renderCommand = (
  resolved: Extract<ResolvedMode, { kind: "commands" }>,
  key: "format" | "validate",
  command: string,
  file: string,
  context: TemplateContext,
): Effect.Effect<string, Error> =>
  Effect.try({
    try: () => renderModeCommand(command, { ...context, file }),
    catch: (e) =>
      new Error(`mode "${resolved.mode}": "${key}" command failed to render — ${errorText(e)}`),
  })

/** The findings a non-zero `validate` exit reports: its output lines, or a synthesized line when it said nothing. */
const findingsFrom = (mode: StateMode, outcome: CommandOutcome): readonly string[] => {
  const lines = outcome.output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
  if (lines.length > 0) return lines
  return [
    `mode "${mode}": validate command exited with ${
      outcome.status === null ? "a signal" : `status ${outcome.status}`
    } and no output`,
  ]
}

/**
 * Format `file` in place per its mode: the markdown formatter for a built-in
 * (skipped for a non-markdown path), the mode's own `format:` command
 * otherwise. A mode with no `format:` formats nothing. A failing command is a
 * hard error — the file is left exactly as it was, and the caller refuses
 * rather than validating a half-formatted file.
 */
export const formatSteeringFile = (
  resolved: ResolvedMode,
  file: string,
  context: TemplateContext,
  cwd: string,
): Effect.Effect<void, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (resolved.kind === "builtin") {
      if (MARKDOWN_STEERING_RE.test(file)) yield* formatFile(file)
      return
    }
    const command = resolved.commands.format
    if (command === undefined) return
    const rendered = yield* renderCommand(resolved, "format", command, file, context)
    const outcome = yield* runCommand(rendered, cwd)
    if (outcome.status !== 0) {
      return yield* Effect.fail(
        new Error(
          `mode "${resolved.mode}": format command exited with ${
            outcome.status === null ? "a signal" : `status ${outcome.status}`
          }${outcome.output.trim().length > 0 ? `:\n${outcome.output.trimEnd()}` : ""}`,
        ),
      )
    }
  })

/**
 * Validate `file` per its mode, returning the findings (empty = valid). A
 * built-in runs its pure parser over `readContent()` (the file's contents AFTER
 * `formatSteeringFile`); a declared mode runs its `validate:` command and reads
 * nothing itself — the command owns how it inspects the file. A mode with no
 * `validate:` reports no findings.
 */
export const validateSteeringFile = (
  resolved: ResolvedMode,
  file: string,
  readContent: () => string,
  context: TemplateContext,
  cwd: string,
): Effect.Effect<readonly string[], Error> =>
  Effect.gen(function* () {
    if (resolved.kind === "builtin") {
      const content = yield* Effect.try({
        try: readContent,
        catch: (e) => new Error(`mode "${resolved.mode}": cannot read ${file} — ${errorText(e)}`),
      })
      return resolved.mode === "qa"
        ? parseOpenQuestions(content).errors
        : parseReviewDoc(content).errors
    }
    const command = resolved.commands.validate
    if (command === undefined) return []
    const rendered = yield* renderCommand(resolved, "validate", command, file, context)
    const outcome = yield* runCommand(rendered, cwd)
    return outcome.status === 0 ? [] : findingsFrom(resolved.mode, outcome)
  })

/**
 * The whole evaluation for one steering file: format it in place, then validate
 * the result. This ORDER is the contract `gtd validate` and the `gtd step`
 * capture gate share (see `src/program.ts`), so a file is never judged in a
 * shape the formatter would have fixed.
 */
export const formatAndValidateSteeringFile = (
  resolved: ResolvedMode,
  file: string,
  readContent: () => string,
  context: TemplateContext,
  cwd: string,
): Effect.Effect<readonly string[], Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    yield* formatSteeringFile(resolved, file, context, cwd)
    return yield* validateSteeringFile(resolved, file, readContent, context, cwd)
  })
