import { Effect } from "effect"
import { CommandRunner, type CommandOutcome } from "./CommandRunner.js"
import { parseOpenQuestions } from "./OpenQuestions.js"
import { parseReviewDoc } from "./ReviewDoc.js"
import {
  isBuiltInMode,
  isKnownBuiltInMode,
  knownModes,
  type BuiltInMode,
  type StateMode,
  type WorkflowDefinition,
} from "./PatternMachine.js"
import { renderModeCommand, type TemplateContext } from "./PatternTemplates.js"

/**
 * The steering-file MODE edge: resolving a state's `mode:` to a format/validate
 * pair and performing it.
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
 *   otherwise, for the two VALIDATOR built-in names (`PatternMachine.BuiltInMode`),
 *   gtd's own pure parser: `qa` → `src/OpenQuestions.ts`, `review` →
 *   `src/ReviewDoc.ts`. Those stay in process because `gtd lsp` publishes the
 *   same parsers as live diagnostics. A third built-in, `prose`
 *   (`PatternMachine.isKnownBuiltInMode`), is FORMAT-ONLY: it is a known mode
 *   name with no in-process parser, so it validates nothing unless a `modes:`
 *   entry declares its own `validate:` command.
 *
 * That per-half layering is what makes a built-in mode EXTENSIBLE rather than
 * all-or-nothing: `modes: { qa: { format: "npx prettier --write <%= it.file %>" } }`
 * adds formatting to `qa` and keeps gtd's open-questions validation; the same
 * shape on `prose` adds formatting with no validation to add or keep.
 *
 * A command is an Eta template rendered with `it.file` bound to the rendered
 * steering-file path, then executed verbatim via `bash -c`. The contract is the
 * shell's own: for `validate`, exit 0 means valid and a non-zero exit means
 * invalid with its output (stdout then stderr) as the findings; for `format`, a
 * non-zero exit is a hard error (broken tooling, not a malformed file). gtd
 * interprets NOTHING beyond exit code and output — the same discipline the loop
 * driver applies to a scripted check actor, and the ONLY place gtd itself spawns
 * a subprocess (a workflow script is run by the driver, never by gtd).
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
 * and an undeclared `validate:` falls back to the built-in PARSER of the same
 * name — only `qa`/`review` have one (`isBuiltInMode`). `prose` is a known
 * built-in NAME with no parser (`isKnownBuiltInMode`), so it resolves without
 * a declaration to `{ mode: "prose" }` — no format, no validate — and gains
 * formatting only, never validation, from a `modes:` layer. `undefined` for a
 * name that is neither declared nor a known built-in — `validateDefinition`
 * rejects that at load time, so the edge only ever sees it as a defensive
 * case.
 */
export const resolveSteeringMode = (
  def: WorkflowDefinition,
  mode: StateMode,
): ResolvedMode | undefined => {
  const declared = def.modes?.[mode]
  if (declared === undefined && !isKnownBuiltInMode(mode)) return undefined
  const builtIn = isBuiltInMode(mode)
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
): Effect.Effect<void, Error, CommandRunner> =>
  Effect.gen(function* () {
    const command = resolved.format
    if (command === undefined) return
    const rendered = yield* renderCommand(resolved.mode, "format", command, file, context)
    const runner = yield* CommandRunner
    const outcome = yield* runner.bash(rendered)
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
 * built-in validator runs its pure parser over `content` (the caller's already
 * read this — see `src/StepGuards.ts`, which samples the file's bytes AFTER
 * `formatSteeringFile` has run); a declared `validate:` command runs instead
 * and reads nothing itself — the command owns how it inspects the file. A mode
 * with neither reports no findings.
 */
export const validateSteeringFile = (
  resolved: ResolvedMode,
  file: string,
  content: string,
  context: TemplateContext,
): Effect.Effect<readonly string[], Error, CommandRunner> =>
  Effect.gen(function* () {
    const validator = resolved.validate
    if (validator === undefined) return []
    if (validator.kind === "builtin") {
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
    const runner = yield* CommandRunner
    const outcome = yield* runner.bash(rendered)
    return outcome.status === 0 ? [] : findingsFrom(resolved.mode, outcome)
  })

/**
 * Runs `formatSteeringFile` then `validateSteeringFile` in sequence — the
 * ORDER `gtd validate` and the `gtd step` capture gate share (see
 * `src/StepGuards.ts`). `content` is validated VERBATIM, exactly as given: a
 * caller that cares about judging POST-format bytes (every production caller
 * does) must sample `content` after this function's format half has run
 * rather than pass a pre-format snapshot — `src/StepGuards.ts` does this
 * itself via its guard `prepare`/`check` split, so this composed helper is
 * kept for symmetry and for `SteeringMode.test.ts`'s real-bash coverage, not
 * called from production code.
 */
export const formatAndValidateSteeringFile = (
  resolved: ResolvedMode,
  file: string,
  content: string,
  context: TemplateContext,
): Effect.Effect<readonly string[], Error, CommandRunner> =>
  Effect.gen(function* () {
    yield* formatSteeringFile(resolved, file, context)
    return yield* validateSteeringFile(resolved, file, content, context)
  })
