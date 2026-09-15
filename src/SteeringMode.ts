import { join } from "node:path"
import { Effect } from "effect"
import { Host } from "./platform/index.js"
import { isSeededValidateCommand } from "./SteeringFormats.js"
import { steeringFormatFor, type SteeringFinding, type SteeringFormat } from "./steering/index.js"
import { knownModes, type StateMode, type WorkflowDefinition } from "./PatternMachine.js"
import { renderModeCommand, type TemplateContext } from "./PatternTemplates.js"
import { buildModeContradictionCheck, modeContradictionSkipNotice } from "./ModeContradiction.js"
import {
  binaryGuard,
  emitScripts,
  extractLeadingBinary,
  fileExistsGuard,
  type EmitStep,
} from "./Emit.js"

/** How a resolved mode validates: a shell command, or a built-in format's own in-process parser. */
export type ResolvedValidator =
  | { readonly kind: "command"; readonly command: string }
  | { readonly kind: "builtin"; readonly format: SteeringFormat }

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

/** A `mode:` name successfully resolved against a definition (or the built-in registry alone). */
export interface ResolvedMode {
  readonly kind: "resolved"
  readonly mode: StateMode
  /** The built-in `SteeringFormat` registered under this mode's NAME (`src/SteeringFormats.ts`), independent of who ends up validating — present even when a declared `validate:` command overrides the format's own parser. Absent when the name is not in the built-in registry at all. */
  readonly format?: SteeringFormat
  /** The `format:` shell command, when some `modes:` layer declared one. Absent = this mode formats nothing. */
  readonly formatCommand?: string
  /** How to validate, or absent when neither a command nor a built-in parser applies (a declared mode with only a `format:`). */
  readonly validate?: ResolvedValidator
  readonly capabilities: SteeringCapabilities
}

/** A `mode:` name that resolved to nothing — the message names what IS known. */
export interface UnknownMode {
  readonly kind: "unknown"
  readonly message: string
}

/** A state's `mode:` resolved against the active definition, or the reason it couldn't be. */
export type ModeResolution = ResolvedMode | UnknownMode

/**
 * `format` alone (no live/external verdict) when there's no validator at
 * all; a live in-process validator for a `"builtin"` validate OR a command
 * that is exactly the format's own seeded string; `externalValidate` for any
 * other command. Each arm returns directly — a flat sequence, not nested
 * ternaries — so the four outcomes stay each their own case to read, not a
 * boolean expression to re-derive.
 */
const capabilitiesFor = (
  mode: StateMode,
  format: SteeringFormat | undefined,
  validate: ResolvedValidator | undefined,
): SteeringCapabilities => {
  if (format === undefined) {
    return validate?.kind === "command" ? { externalValidate: true } : {}
  }
  if (validate?.kind === "builtin") return { format, liveValidate: format.validate }
  if (validate === undefined) return { format }
  if (isSeededValidateCommand(mode, validate.command)) {
    return { format, liveValidate: format.validate }
  }
  return { format, externalValidate: true }
}

/**
 * Resolve a `mode:` name against `def.modes` plus the built-in registry
 * (`src/SteeringFormats.ts`) — half by half: a declared `format:`/`validate:`
 * wins, and an undeclared `validate:` falls back to the built-in format's own
 * parser when the name is registered. `format` is set from the registry
 * ALONE, independent of which half of `validate` wins — a declared validator
 * overrides validation, not the format identity.
 *
 * `def: undefined` is the LSP's built-in-only fallback — resolving `mode`
 * against the registry alone, with no workflow definition in hand (e.g. the
 * basename dispatch for a `REVIEW.md` no config maps).
 *
 * The `"unknown"` arm carries the whole refusal message, naming what IS known
 * when `def` is given — this is the one place that message is built, so it
 * can never drift from what actually resolved.
 */
export const resolveMode = (
  def: WorkflowDefinition | undefined,
  state: string,
  mode: StateMode,
): ModeResolution => {
  const declared = def?.modes?.[mode]
  const format = steeringFormatFor(mode)
  if (declared === undefined && format === undefined) {
    return {
      kind: "unknown",
      message:
        def !== undefined
          ? `state "${state}": mode "${mode}" is not defined by the active workflow (known modes: ${knownModes(def).join(", ")})`
          : `mode "${mode}" is not a built-in steering format`,
    }
  }
  const validate: ResolvedValidator | undefined =
    declared?.validate !== undefined
      ? { kind: "command", command: declared.validate }
      : format !== undefined
        ? { kind: "builtin", format }
        : undefined
  return {
    kind: "resolved",
    mode,
    ...(format !== undefined ? { format } : {}),
    ...(declared?.format !== undefined ? { formatCommand: declared.format } : {}),
    ...(validate !== undefined ? { validate } : {}),
    capabilities: capabilitiesFor(mode, format, validate),
  }
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

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

/** `gtd next`'s fix-retry instruction, printed ahead of the failing command's captured output. */
const fixPromptInstruction = (file: string): string =>
  `Your last turn does not pass its own validation script. Fix these format violations in ${file}, then finish:`

/**
 * Pushes a `binaryGuard` step ahead of `command` when its own leading word
 * is unambiguous — BEFORE, not wrapped around: a guard that fails must stop
 * the script on its own `exit 127`, without touching `failurePromptWrapper`'s
 * captured-output path. Each command guards on its OWN leading word — a
 * guard naming the wrong binary is worse than none.
 */
const pushGuardedCommand = (
  steps: EmitStep[],
  mode: StateMode,
  key: "format" | "validate",
  command: string,
  onFailure: string | undefined,
): void => {
  const binary = extractLeadingBinary(command)
  if (binary !== undefined) {
    steps.push({ kind: "command", command: binaryGuard(binary, mode, key) })
  }
  steps.push({ kind: "command", command, ...(onFailure !== undefined ? { onFailure } : {}) })
}

/**
 * `resolved`'s `format:`/`validate:` rendered as `EmitStep[]` — format first,
 * validate last, the last one wrapped with `onFailure` when the validator is
 * a command (a built-in's own in-process parser has no shell step to wrap:
 * `gtd check`'s seeded command carries that instead). Each command gets its
 * own `binaryGuard` immediately ahead of it.
 */
const renderModeCommandSteps = (
  resolved: ResolvedMode,
  file: string,
  context: TemplateContext,
): Effect.Effect<readonly EmitStep[], Error> =>
  Effect.gen(function* () {
    const steps: EmitStep[] = []
    if (resolved.formatCommand !== undefined) {
      const command = yield* renderCommand(
        resolved.mode,
        "format",
        resolved.formatCommand,
        file,
        context,
      )
      pushGuardedCommand(steps, resolved.mode, "format", command, undefined)
    }
    if (resolved.validate?.kind === "command") {
      const command = yield* renderCommand(
        resolved.mode,
        "validate",
        resolved.validate.command,
        file,
        context,
      )
      pushGuardedCommand(steps, resolved.mode, "validate", command, fixPromptInstruction(file))
    }
    return steps
  })

/** `<Host.scratchDir>/gtd-mode-sample-<mode>-<pid>.md` — an absolute literal baked in at emit time, never a shell variable. `<pid>` avoids collisions between concurrent `gtd` processes. Never a `/tmp` literal or `mktemp` (`tests/tooling/no-tmp-assumption.test.ts` scans for both). */
const scratchSamplePath = (scratchDir: string, mode: StateMode): string =>
  join(scratchDir, `gtd-mode-sample-${mode}-${process.pid}.md`)

/**
 * The contradiction round-trip/skip-notice steps for `resolved`'s `mode:`.
 * No `formatCommand` means nothing to round-trip: empty. Otherwise: a live
 * built-in validator runs the round-trip against that format's own canonical
 * sample; an external validator prints a one-line skip notice instead, since
 * silence there would read as a clean bill of health; a format-only mode with
 * neither has nothing to round-trip either.
 */
const modeContradictionSteps = (
  resolved: ResolvedMode,
  context: TemplateContext,
): Effect.Effect<readonly EmitStep[], Error, Host> =>
  Effect.gen(function* () {
    if (resolved.formatCommand === undefined) return []
    const { capabilities } = resolved
    if (capabilities.format !== undefined && capabilities.liveValidate !== undefined) {
      const { scratchDir } = yield* Host
      const samplePath = scratchSamplePath(scratchDir, resolved.mode)
      const formatCommand = yield* renderCommand(
        resolved.mode,
        "format",
        resolved.formatCommand,
        samplePath,
        context,
      )
      return [
        {
          kind: "command",
          command: buildModeContradictionCheck({
            mode: resolved.mode,
            samplePath,
            sample: capabilities.format.sample,
            formatCommand,
          }),
        },
      ]
    }
    if (capabilities.externalValidate === true) {
      return [{ kind: "command", command: modeContradictionSkipNotice(resolved.mode) }]
    }
    return []
  })

/** A resolved mode's full format-then-validate script text — a VALUE, never an execution. Carries the contradiction round-trip, the file-existence guard, and the format/validate commands, exactly as `gtd validate`/`gtd next --json`'s `validate` field emit them. */
export interface ValidateScript {
  readonly script: string
}

/**
 * Renders `resolved`'s complete validate script for `file`: the mode's
 * format/validate contradiction check, a guard for a not-yet-written file,
 * then the format/validate commands themselves (format first). gtd never
 * runs this script itself — `resolveMode`+`validateScriptFor` only render
 * text for a driver to execute (`gtd renders; the driver executes`).
 */
export const validateScriptFor = (
  resolved: ResolvedMode,
  file: string,
  context: TemplateContext,
): Effect.Effect<ValidateScript, Error, Host> =>
  Effect.gen(function* () {
    const steps: EmitStep[] = [
      ...(yield* modeContradictionSteps(resolved, context)),
      { kind: "command", command: fileExistsGuard(file) },
      ...(yield* renderModeCommandSteps(resolved, file, context)),
    ]
    return { script: emitScripts(steps).required }
  })
