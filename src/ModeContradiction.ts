import { shellQuote } from "./GitScript.js"

/** Every value `buildModeContradictionCheck` needs, already resolved/rendered by the caller. */
export interface ModeContradictionInputs {
  readonly mode: string
  /** Absolute scratch path the sample is written to, formatted at, and removed from. */
  readonly samplePath: string
  /** The format's own canonical sample (`SteeringFormat.sample`), written verbatim via `printf '%s'`. */
  readonly sample: string
  /** The mode's `format:` command, ALREADY RENDERED with `it.file` bound to `samplePath`. */
  readonly formatCommand: string
}

/**
 * Written for two readers at once, since gtd validate's exit code carries no
 * second meaning to distinguish them: the agent (this is a CONFIGURATION BUG,
 * not the steering file — stop, don't edit it, or a fix-retry loop will
 * thrash on the document) and the human (which mode, and the exact rendered
 * `format:` command, to fix `.gtdrc.json` without reproducing the failure).
 */
export const contradictionMessage = (mode: string, formatCommand: string): string =>
  `gtd: mode "${mode}"'s format: command breaks its own validator — this is a ` +
  `CONFIGURATION BUG, not a problem with the steering file. Do NOT edit the ` +
  `steering file — stop and end your turn now.\n` +
  `The rendered format: command that ran:\n${formatCommand}\n` +
  `What it turned mode "${mode}"'s own canonical sample into:`

/**
 * Formats a copy of the mode's own canonical sample and re-validates it with
 * `gtd check <mode>`, failing loudly when the round-trip breaks it — detects a
 * mode whose `format:` contradicts its own `validate:` without ever touching
 * the real steering file. `printf '%s'` over a `shellQuote`d sample, never a
 * heredoc, since no delimiter chosen ahead of time can collide with the
 * sample's own bytes. One bash fragment with no blank lines (so
 * `src/Emit.ts`'s `assembleScript` never splits it from a sibling step), meant
 * to run BEFORE `[ -f <file> ] || exit 0` in the emitted validate script so it
 * still fires at a first-write beat where the real steering file doesn't
 * exist yet.
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
 * Skip notice for a mode whose validator is EXTERNAL (a user `validate:`
 * command, not one of the two built-in modes) — there's no in-process parser
 * to round-trip a sample through. Printed to stderr since silence would read
 * as a clean bill of health.
 */
export const modeContradictionSkipNotice = (mode: string): string => {
  const message = `gtd: mode "${mode}" has an external validate: command — skipping the format/validate contradiction check`
  return `printf '%s\\n' ${shellQuote(message)} >&2`
}
