import { Effect } from "effect"
import { spawnSync } from "node:child_process"
import { parseOpenQuestions } from "./OpenQuestions.js"
import { parseReviewDoc } from "./ReviewDoc.js"
import {
  isBuiltInMode,
  knownModes,
  type BuiltInMode,
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
 * The two halves resolve INDEPENDENTLY, each from the first layer that provides
 * it:
 *
 * - **format** — only ever a `modes:` entry's `format:` SHELL COMMAND. gtd
 *   ships no formatter of its own: a project brings `prettier`, `dprint`, or a
 *   script of its own and plugs it into whichever mode it wants formatted. No
 *   command, no formatting.
 * - **validate** — a `modes:` entry's `validate:` command if declared;
 *   otherwise, for the two BUILT-IN names (`PatternMachine.BuiltInMode`), gtd's
 *   own pure parser: `qa` → `src/OpenQuestions.ts`, `review` →
 *   `src/ReviewDoc.ts`. Those stay in process because `gtd lsp` publishes the
 *   same parsers as live diagnostics.
 *
 * That per-half layering is what makes a built-in mode EXTENSIBLE rather than
 * all-or-nothing: `modes: { qa: { format: "npx prettier --write <%= it.file %>" } }`
 * adds formatting to `qa` and keeps gtd's open-questions validation.
 *
 * A command is an Eta template rendered with `it.file` bound to the rendered
 * steering-file path, then executed verbatim via `bash -c`. The contract is the
 * shell's own: for `validate`, exit 0 means valid and a non-zero exit means
 * invalid with its output (stdout then stderr) as the findings; for `format`, a
 * non-zero exit is a hard error (broken tooling, not a malformed file). gtd
 * interprets NOTHING beyond exit code and output — same discipline as the
 * scripted check actor (`gtd run`), and the second (and last) place gtd spawns
 * a subprocess.
 */

/** How a resolved mode validates: a shell command, or gtd's own in-process parser. */
export type ResolvedValidator =
  | { readonly kind: "command"; readonly command: string }
  | { readonly kind: "builtin"; readonly mode: BuiltInMode }

/** A state's `mode:` resolved against the active definition — each half from the first layer that provides it (see the module docstring). */
export interface ResolvedMode {
  readonly mode: StateMode
  /** The `format:` shell command, when some `modes:` layer declared one. Absent = this mode formats nothing. */
  readonly format?: string
  /** How to validate, or absent when neither a command nor a built-in parser applies (a declared mode with only a `format:`). */
  readonly validate?: ResolvedValidator
}

/**
 * Resolve a `mode:` name, half by half: a declared `format:`/`validate:` wins,
 * and an undeclared `validate:` falls back to the built-in parser of the same
 * name. `undefined` for a name that is neither declared nor built in —
 * `validateDefinition` rejects that at load time, so the edge only ever sees it
 * as a defensive case.
 */
export const resolveSteeringMode = (
  def: WorkflowDefinition,
  mode: StateMode,
): ResolvedMode | undefined => {
  const declared = def.modes?.[mode]
  const builtIn = isBuiltInMode(mode)
  if (declared === undefined && !builtIn) return undefined
  const validate: ResolvedValidator | undefined =
    declared?.validate !== undefined
      ? { kind: "command", command: declared.validate }
      : builtIn
        ? { kind: "builtin", mode }
        : undefined
  return {
    mode,
    ...(declared?.format !== undefined ? { format: declared.format } : {}),
    ...(validate !== undefined ? { validate } : {}),
  }
}

/** The error message for a `mode:` that resolves to nothing — lists what the active workflow does know. */
export const unknownModeMessage = (
  def: WorkflowDefinition,
  state: string,
  mode: StateMode,
): string =>
  `state "${state}": mode "${mode}" is not defined by the active workflow (known modes: ${knownModes(def).join(", ")})`

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

/** How a non-zero exit reads in a message: a status number, or a signal death. */
const exitText = (status: number | null): string =>
  status === null ? "a signal" : `status ${status}`

/** Render one command template, turning an Eta failure into a named error rather than executing anything. */
const renderCommand = (
  mode: StateMode,
  key: "format" | "validate",
  command: string,
  file: string,
  context: TemplateContext,
): Effect.Effect<string, Error> =>
  Effect.try({
    try: () => renderModeCommand(command, { ...context, file }),
    catch: (e) => new Error(`mode "${mode}": "${key}" command failed to render — ${errorText(e)}`),
  })

/** The findings a non-zero `validate` exit reports: its output lines, or a synthesized line when it said nothing. */
const findingsFrom = (mode: StateMode, outcome: CommandOutcome): readonly string[] => {
  const lines = outcome.output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
  if (lines.length > 0) return lines
  return [`mode "${mode}": validate command exited with ${exitText(outcome.status)} and no output`]
}

/**
 * Format `file` in place by running the mode's `format:` command. A mode with
 * no formatter (every mode, until a `modes:` layer declares one — gtd ships
 * none) formats nothing. A failing command is a hard error: the file is left
 * exactly as it was and the caller refuses, rather than validating a
 * half-formatted file.
 */
export const formatSteeringFile = (
  resolved: ResolvedMode,
  file: string,
  context: TemplateContext,
  cwd: string,
): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const command = resolved.format
    if (command === undefined) return
    const rendered = yield* renderCommand(resolved.mode, "format", command, file, context)
    const outcome = yield* runCommand(rendered, cwd)
    if (outcome.status !== 0) {
      return yield* Effect.fail(
        new Error(
          `mode "${resolved.mode}": format command exited with ${exitText(outcome.status)}${
            outcome.output.trim().length > 0 ? `:\n${outcome.output.trimEnd()}` : ""
          }`,
        ),
      )
    }
  })

/**
 * Validate `file` per its mode, returning the findings (empty = valid). A
 * built-in validator runs its pure parser over `readContent()` (the file's
 * contents AFTER `formatSteeringFile`); a declared `validate:` command runs
 * instead and reads nothing itself — the command owns how it inspects the file.
 * A mode with neither reports no findings.
 */
export const validateSteeringFile = (
  resolved: ResolvedMode,
  file: string,
  readContent: () => string,
  context: TemplateContext,
  cwd: string,
): Effect.Effect<readonly string[], Error> =>
  Effect.gen(function* () {
    const validator = resolved.validate
    if (validator === undefined) return []
    if (validator.kind === "builtin") {
      const content = yield* Effect.try({
        try: readContent,
        catch: (e) => new Error(`mode "${resolved.mode}": cannot read ${file} — ${errorText(e)}`),
      })
      return validator.mode === "qa"
        ? parseOpenQuestions(content).errors
        : parseReviewDoc(content).errors
    }
    const rendered = yield* renderCommand(
      resolved.mode,
      "validate",
      validator.command,
      file,
      context,
    )
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
): Effect.Effect<readonly string[], Error> =>
  Effect.gen(function* () {
    yield* formatSteeringFile(resolved, file, context, cwd)
    return yield* validateSteeringFile(resolved, file, readContent, context, cwd)
  })
