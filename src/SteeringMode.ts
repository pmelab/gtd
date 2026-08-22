import { Effect } from "effect"
import { GtdError } from "./Commentary.js"
import { CommandRunner, type CommandOutcome } from "./CommandRunner.js"
import { EnvVars } from "./EnvVars.js"
import { isSeededValidateCommand, steeringFormatFor } from "./SteeringFormats.js"
import type { SteeringFinding, SteeringFormat } from "./SteeringFormat.js"
import { knownModes, type StateMode, type WorkflowDefinition } from "./PatternMachine.js"
import { renderModeCommand, type TemplateContext } from "./PatternTemplates.js"

/** How a resolved mode validates: a shell command, or a built-in format's own in-process parser. */
export type ResolvedValidator =
  | { readonly kind: "command"; readonly command: string }
  | { readonly kind: "builtin"; readonly format: SteeringFormat }

/** A state's `mode:` resolved against the active definition: `format`/`validate` each resolve independently, from the first layer that provides them (a declared `modes:` command, else — for `validate` only — a built-in format's own parser). */
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
 * Resolve a `mode:` name against `def.modes` plus the built-in registry
 * (`src/SteeringFormats.ts`) — half by half: a declared `format:`/`validate:`
 * wins, and an undeclared `validate:` falls back to the built-in format's own
 * parser when the name is registered. `builtIn` is set from the registry
 * ALONE, independent of which half of `validate` wins — a declared validator
 * overrides validation, not the format identity. `undefined` for a name
 * neither declared nor built in; `validateDefinition` rejects that at load
 * time, so this is a defensive case.
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
 * What a resolved mode can DO, for a consumer (the LSP, the sign-off/answer
 * gates) that only cares about capability, not resolution mechanics:
 * `liveValidate` is the built-in format's own `validate` function, present
 * when the validator is either the built-in kind OR a command that is gtd's
 * own SEEDED string for this mode (`isSeededValidateCommand` — the compiler
 * seeding `qa`/`review`'s own `gtd check` command behind the scenes changes
 * nothing about how the file is actually validated). `externalValidate` is
 * `true` for a genuine user override of a built-in mode's `validate:`, or any
 * command-validated non-built-in mode — the LSP shows a notice for that
 * instead of live diagnostics.
 */
export interface SteeringCapabilities {
  readonly format?: SteeringFormat
  readonly liveValidate?: (content: string) => readonly SteeringFinding[]
  readonly externalValidate?: boolean
}

export const steeringCapabilities = (resolved: ResolvedMode | undefined): SteeringCapabilities => {
  if (resolved === undefined) return {}
  const seeded =
    resolved.builtIn !== undefined &&
    resolved.validate?.kind === "command" &&
    isSeededValidateCommand(resolved.mode, resolved.validate.command)
  const liveValidate =
    resolved.builtIn !== undefined && (resolved.validate?.kind === "builtin" || seeded)
      ? resolved.builtIn.validate
      : undefined
  return {
    ...(resolved.builtIn !== undefined ? { format: resolved.builtIn } : {}),
    ...(liveValidate !== undefined ? { liveValidate } : {}),
    ...(resolved.validate?.kind === "command" && !seeded ? { externalValidate: true } : {}),
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

/**
 * `127` is bash's own convention for "command not found" — the ONE
 * observable "missing binary" site in gtd: a steering mode's `format:`/
 * `validate:` command, the only place gtd itself spawns a subprocess (a
 * workflow `script:` is run by the driver, never by gtd). The resolved
 * `$PATH` bash searched is the remediation detail (`Commentary.ts`'s
 * `GtdError`).
 */
const MISSING_BINARY_STATUS = 127

const missingBinaryError = (
  mode: StateMode,
  key: "format" | "validate",
  path: string | undefined,
): GtdError =>
  new GtdError(`mode "${mode}": "${key}" command not found`, [`$PATH: ${path ?? "(unset)"}`])

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

/** The findings a non-zero `validate` exit reports: its output lines, or a synthesized line when it said nothing. A shell command's findings can never carry a line — gtd sees only its stdout/stderr text, so each output line maps to a positionless finding. */
const findingsFrom = (mode: StateMode, outcome: CommandOutcome): readonly SteeringFinding[] => {
  const lines = outcome.output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
  if (lines.length > 0) return lines.map((message) => ({ message }))
  return [
    {
      message: `mode "${mode}": validate command exited with ${exitText(outcome.status)} and no output`,
    },
  ]
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
): Effect.Effect<void, Error, CommandRunner | EnvVars> =>
  Effect.gen(function* () {
    const command = resolved.formatCommand
    if (command === undefined) return
    const rendered = yield* renderCommand(resolved.mode, "format", command, file, context)
    const runner = yield* CommandRunner
    const outcome = yield* runner.bash(rendered)
    if (outcome.status === MISSING_BINARY_STATUS) {
      const envVars = yield* EnvVars
      return yield* Effect.fail(missingBinaryError(resolved.mode, "format", envVars.all["PATH"]))
    }
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
): Effect.Effect<readonly SteeringFinding[], Error, CommandRunner | EnvVars> =>
  Effect.gen(function* () {
    const validator = resolved.validate
    if (validator === undefined) return []
    if (validator.kind === "builtin") {
      return validator.format.validate(content)
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
    if (outcome.status === MISSING_BINARY_STATUS) {
      const envVars = yield* EnvVars
      return yield* Effect.fail(missingBinaryError(resolved.mode, "validate", envVars.all["PATH"]))
    }
    return outcome.status === 0 ? [] : findingsFrom(resolved.mode, outcome)
  })

/**
 * Runs `formatSteeringFile` then `validateSteeringFile` in sequence.
 * `content` is validated VERBATIM: a caller that cares about POST-format
 * bytes (every production caller does) must sample `content` after this
 * function's format half has run. `src/StepGuards.ts` does that itself via
 * its guard `prepare`/`check` split, so this composed helper exists for
 * symmetry and `SteeringMode.test.ts`'s real-bash coverage, not production use.
 */
export const formatAndValidateSteeringFile = (
  resolved: ResolvedMode,
  file: string,
  content: string,
  context: TemplateContext,
): Effect.Effect<readonly SteeringFinding[], Error, CommandRunner | EnvVars> =>
  Effect.gen(function* () {
    yield* formatSteeringFile(resolved, file, context)
    return yield* validateSteeringFile(resolved, file, content, context)
  })

/**
 * Render a mode's `format:`/`validate:` commands as plain strings, WITHOUT
 * running either — for a caller (an emitter that prints scripts) that wants
 * the commands themselves. Needs no `CommandRunner`. A half the mode doesn't
 * declare, or a `"builtin"` validator (no shell command to render), is
 * OMITTED from the result, not rendered as `""`.
 */
export const renderSteeringCommands = (
  resolved: ResolvedMode,
  file: string,
  context: TemplateContext,
): Effect.Effect<readonly string[], Error> =>
  Effect.gen(function* () {
    const commands: string[] = []
    if (resolved.formatCommand !== undefined) {
      commands.push(
        yield* renderCommand(resolved.mode, "format", resolved.formatCommand, file, context),
      )
    }
    if (resolved.validate?.kind === "command") {
      commands.push(
        yield* renderCommand(resolved.mode, "validate", resolved.validate.command, file, context),
      )
    }
    return commands
  })
