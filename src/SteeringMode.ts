import { Effect } from "effect"
import { CommandRunner, type CommandOutcome } from "./CommandRunner.js"
import { steeringFormatFor } from "./SteeringFormats.js"
import type { SteeringFormat } from "./SteeringFormat.js"
import { knownModes, type StateMode, type WorkflowDefinition } from "./PatternMachine.js"
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
 *   otherwise, for a name the built-in registry knows (`src/SteeringFormats.ts`
 *   — currently `qa`/`review`), that format's own pure parser (`SteeringFormat.
 *   validate`). Those stay in process because `gtd lsp` publishes the same
 *   parsers as live diagnostics/outline/actions. Any OTHER mode name — `prose`,
 *   or any workflow-declared name — is FORMAT-ONLY unless a `modes:` entry
 *   declares its own `validate:` command: it has no in-process parser, so it
 *   validates nothing on its own.
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

/** How a resolved mode validates: a shell command, or a built-in format's own in-process parser. */
export type ResolvedValidator =
  | { readonly kind: "command"; readonly command: string }
  | { readonly kind: "builtin"; readonly format: SteeringFormat }

/** A state's `mode:` resolved against the active definition — each half from the first layer that provides it (see the module docstring). */
export interface ResolvedMode {
  readonly mode: StateMode
  /** The built-in `SteeringFormat` registered under this mode's NAME (`src/SteeringFormats.ts`), independent of who ends up validating — present even when a declared `validate:` command overrides the format's own parser (see `resolveSteeringMode`). Absent when the name is not in the built-in registry at all. */
  readonly builtIn?: SteeringFormat
  /** The `format:` shell command, when some `modes:` layer declared one. Absent = this mode formats nothing. */
  readonly formatCommand?: string
  /** How to validate, or absent when neither a command nor a built-in parser applies (a declared mode with only a `format:`). */
  readonly validate?: ResolvedValidator
}

/**
 * Resolve a `mode:` name against ONLY `def.modes` plus the built-in registry
 * (`src/SteeringFormats.ts`) — half by half: a declared `format:`/`validate:`
 * wins, and an undeclared `validate:` falls back to the built-in format's own
 * parser when the name is registered. `builtIn` is set from the registry
 * ALONE, independent of which half of `validate` ends up winning — so
 * `modes: { qa: { validate: "…" } }` still carries `builtIn: QA_FORMAT`
 * (a declared validator overrides validation, not the format identity;
 * `steeringCapabilities` is what reads `validate.kind` to decide whether the
 * format's own parser is actually live). `undefined` for a name that is
 * neither declared in `def.modes` nor in the built-in registry —
 * `validateDefinition` rejects that at load time, so the edge only ever sees
 * it as a defensive case.
 */
export const resolveSteeringMode = (
  def: WorkflowDefinition,
  mode: StateMode,
): ResolvedMode | undefined => {
  const declared = def.modes?.[mode]
  const builtIn = steeringFormatFor(mode)
  if (declared === undefined && builtIn === undefined) return undefined
  const validate: ResolvedValidator | undefined =
    declared?.validate !== undefined
      ? { kind: "command", command: declared.validate }
      : builtIn !== undefined
        ? { kind: "builtin", format: builtIn }
        : undefined
  return {
    mode,
    ...(builtIn !== undefined ? { builtIn } : {}),
    ...(declared?.format !== undefined ? { formatCommand: declared.format } : {}),
    ...(validate !== undefined ? { validate } : {}),
  }
}

/**
 * Resolve `mode` against the built-in registry ALONE, with no workflow
 * definition in hand — the LSP's basename fallback (e.g. `REVIEW.md` when no
 * config maps it), which has a path but no state to read `def.modes` from.
 * `undefined` when `mode` names no built-in format.
 */
export const resolveBuiltInMode = (mode: StateMode): ResolvedMode | undefined => {
  const builtIn = steeringFormatFor(mode)
  if (builtIn === undefined) return undefined
  return { mode, builtIn, validate: { kind: "builtin", format: builtIn } }
}

/**
 * What a resolved mode can DO, read off `ResolvedMode` for a consumer (the LSP,
 * the sign-off/answer gates) that only cares about capability, not resolution
 * mechanics: `format` is the built-in format (outline/actions/pointer), present
 * whenever `builtIn` is; `liveValidate` is that format's own `validate`
 * function, present IFF `validate.kind === "builtin"` (a declared `validate:`
 * command displaces it); `externalValidate` is `true` IFF `validate.kind ===
 * "command"` — a shell-validated mode, which the LSP shows a notice for instead
 * of live diagnostics.
 */
export interface SteeringCapabilities {
  readonly format?: SteeringFormat
  readonly liveValidate?: (content: string) => readonly string[]
  readonly externalValidate?: boolean
}

export const steeringCapabilities = (resolved: ResolvedMode | undefined): SteeringCapabilities => {
  if (resolved === undefined) return {}
  return {
    ...(resolved.builtIn !== undefined ? { format: resolved.builtIn } : {}),
    ...(resolved.validate?.kind === "builtin"
      ? { liveValidate: resolved.validate.format.validate }
      : {}),
    ...(resolved.validate?.kind === "command" ? { externalValidate: true } : {}),
  }
}

/** The error message for a `mode:` that resolves to nothing — lists what the active workflow does know. */
export const unknownModeMessage = (
  def: WorkflowDefinition,
  state: string,
  mode: StateMode,
): string =>
  `state "${state}": mode "${mode}" is not defined by the active workflow (known modes: ${knownModes(def).join(", ")})`

/**
 * Run one rendered mode command via the injected `CommandRunner`, capturing
 * output instead of inheriting the terminal (unlike a workflow script, which
 * the driver runs with inherited stdio because its output IS the point):
 * here the output is data — a validate command's findings are reported to
 * the agent that must fix them. A spawn failure (no `bash`, an unreadable
 * cwd) fails the Effect; a non-zero EXIT is a value, since that is the mode's
 * way of saying "invalid".
 */
const runCommand = (
  command: string,
  cwd: string,
): Effect.Effect<CommandOutcome, Error, CommandRunner> =>
  Effect.gen(function* () {
    const runner = yield* CommandRunner
    return yield* runner.run(command, cwd)
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
): Effect.Effect<void, Error, CommandRunner> =>
  Effect.gen(function* () {
    const command = resolved.formatCommand
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
): Effect.Effect<readonly string[], Error, CommandRunner> =>
  Effect.gen(function* () {
    const validator = resolved.validate
    if (validator === undefined) return []
    if (validator.kind === "builtin") {
      const content = yield* Effect.try({
        try: readContent,
        catch: (e) => new Error(`mode "${resolved.mode}": cannot read ${file} — ${errorText(e)}`),
      })
      return validator.format.validate(content)
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
): Effect.Effect<readonly string[], Error, CommandRunner> =>
  Effect.gen(function* () {
    yield* formatSteeringFile(resolved, file, context, cwd)
    return yield* validateSteeringFile(resolved, file, readContent, context, cwd)
  })
