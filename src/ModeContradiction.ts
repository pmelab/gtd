/**
 * The steering-mode CONTRADICTION round-trip: a pure bash-block builder that
 * catches a mode whose `format:` command breaks its own `validate:` —
 * something gtd can detect mechanically without ever touching the real
 * steering file: format a copy of the format's own canonical sample
 * (`SteeringFormat.sample`), re-validate the result with `gtd check <mode>`,
 * and fail loudly (never silently) when the round-trip broke it.
 *
 * Pure: no Effect, no git, no filesystem, no ambient reads. Every value this
 * module needs — the scratch path, the sample bytes, the mode's already-
 * rendered `format:` command — arrives as an argument; `src/program.ts`
 * resolves the scratch path (`EnvVars`) and renders the `format:` template
 * (with `it.file` bound to that scratch path, never the real file), and this
 * module only concatenates the block those values assemble into.
 *
 * `printf '%s'` over a `shellQuote`d sample, never a heredoc — no delimiter
 * chosen ahead of time can collide with the sample's own bytes. `gtd check
 * <mode> <samplePath>` is the re-validation: the same in-process parser a
 * seeded `validate:` command already leaf-invokes, so this adds no new
 * mechanism and assumes no new binary on `$PATH` beyond `gtd` itself.
 * `cat`ing the formatted sample to stderr on failure is what gives a human
 * reader "what the round-trip turned the sample into" — only knowable at run
 * time, so it can't be baked into the message string ahead of it.
 *
 * The message is written for two readers at once, because gtd validate's own
 * exit code carries no second meaning (see the README's exit-code table) —
 * the message text is the WHOLE signal distinguishing "the config is broken"
 * from "the file is malformed". To the agent, first and unmistakably: this is
 * a configuration bug, not the steering file — do not edit it, stop and end
 * the turn (without this, an agent handed "validation failed" up to 3 times
 * under a driver's fix-retry cap will thrash on the document and can mangle
 * good work before the loop dies). To the human, second: which mode
 * contradicts itself and the exact rendered `format:` command that ran — the
 * `cat`'d sample (assembled by the block itself, not this message) is the
 * third piece, enough together to fix `.gtdrc.json` or the formatter's own
 * config without reproducing the failure by hand. Deliberately NOT
 * `src/program.ts`'s `fixPromptInstruction` text (which blames the TURN) and
 * sharing no wording with it — since the exit code no longer distinguishes
 * the two cases, reusing that wrapper would erase the distinction completely.
 */

import { shellQuote } from "./GitScript.js"

/** Every value `buildModeContradictionCheck` needs, already resolved/rendered by the caller. */
export interface ModeContradictionInputs {
  /** The mode name (e.g. `"qa"`/`"review"`) — named in the message and passed to `gtd check`. */
  readonly mode: string
  /** An absolute, literal scratch path (never re-derived by this module) the sample is written to, formatted at, and removed from. */
  readonly samplePath: string
  /** The format's own canonical sample (`SteeringFormat.sample`), written verbatim via `printf '%s'`. */
  readonly sample: string
  /** The mode's `format:` command, ALREADY RENDERED with `it.file` bound to `samplePath` — this module renders nothing. */
  readonly formatCommand: string
}

/**
 * The two-reader message `buildModeContradictionCheck` prints to stderr ahead
 * of the `cat`'d formatted sample. Exported on its own so a test (or a future
 * caller) can assert on its exact text without re-deriving the whole block.
 */
export const contradictionMessage = (mode: string, formatCommand: string): string =>
  `gtd: mode "${mode}"'s format: command breaks its own validator — this is a ` +
  `CONFIGURATION BUG, not a problem with the steering file. Do NOT edit the ` +
  `steering file — stop and end your turn now.\n` +
  `The rendered format: command that ran:\n${formatCommand}\n` +
  `What it turned mode "${mode}"'s own canonical sample into:`

/**
 * The round-trip block itself — one self-contained bash fragment with no
 * blank lines (so `src/Emit.ts`'s `assembleScript` never splits it from a
 * sibling step), meant to run BEFORE `[ -f <file> ] || exit 0` in the emitted
 * validate script (see `src/program.ts`'s `resolveValidateScript`) so it still
 * fires at a first-write beat where the real steering file does not exist
 * yet. Exits non-zero (after printing the message and the formatted sample)
 * on a contradiction; otherwise removes the sample and falls through.
 */
export const buildModeContradictionCheck = (inputs: ModeContradictionInputs): string => {
  const { mode, samplePath, sample, formatCommand } = inputs
  const pathQ = shellQuote(samplePath)
  const messageQ = shellQuote(contradictionMessage(mode, formatCommand))
  return [
    `printf '%s' ${shellQuote(sample)} > ${pathQ}`,
    formatCommand,
    `gtd check ${mode} ${pathQ} >/dev/null 2>&1 || {`,
    `  printf '%s\\n' ${messageQ} >&2`,
    `  cat ${pathQ} >&2`,
    `  rm -f ${pathQ}`,
    `  exit 1`,
    `}`,
    `rm -f ${pathQ}`,
  ].join("\n")
}

/**
 * The one-line skip notice for a mode whose validator is EXTERNAL (a user
 * `validate:` command that is not gtd's own seeded string) — coverage is the
 * two built-in modes only (`src/SteeringFormats.ts`'s registry), so there is
 * no in-process parser to round-trip a sample through. Printed to stderr and
 * nothing else runs — silence would read as a clean bill of health.
 */
export const modeContradictionSkipNotice = (mode: string): string => {
  const message = `gtd: mode "${mode}" has an external validate: command — skipping the format/validate contradiction check`
  return `printf '%s\\n' ${shellQuote(message)} >&2`
}
