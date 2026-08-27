import { shellQuote } from "./GitScript.js"

/** The plain-text twin of `printfLine`: substitutes `args` into `fmt`'s `%s` placeholders, in order. */
export const renderFormat = (fmt: string, ...args: readonly string[]): string => {
  let i = 0
  return fmt.replace(/%s/g, () => args[i++] ?? "")
}

/**
 * A `printf '<fmt>' <args...>` bash statement — `args` are already-valid bash
 * tokens (a `shellQuote`d literal, a `"$(git …)"` substitution), never
 * re-quoted here: a value reaches the script as a printf ARGUMENT, never
 * interpolated into the format itself, so a subject or state name containing
 * `%` can never be read as a conversion spec. Markers like `->` are arguments
 * too, keeping every format string free of a leading `-` that a shell's
 * `printf` could mistake for an option. A real newline in `fmt` is emitted as
 * the two-character `\n` escape `printf` itself expands, keeping every emitted
 * statement on one line.
 */
const printfLine = (fmt: string, args: readonly string[]): string =>
  `${OUTCOME_MARKER}\nprintf ${shellQuote(fmt.replace(/\n/g, "\\n"))} ${args.join(" ")}`

/**
 * Marks an emitted block as print-only. Load-bearing beyond documentation:
 * `src/testing/EmittedScriptRecognizer.ts` recognizes an outcome block by
 * this line, and a bare `printf` would be ambiguous with a workflow
 * `script:` command that happens to start the same way.
 */
export const OUTCOME_MARKER = "# gtd: outcome (print-only)"

const FMT_ABANDON_NOOP = 'no gtd process is underway (resting at "%s") — nothing to abandon\n'
const FMT_ABANDONED =
  'abandoned the process resting at "%s" — HEAD is back at %s ("%s"), resting at "%s".\n' +
  "Everything the process produced is kept as uncommitted changes (`git status`); " +
  "discard them with `git checkout -- . && git clean -fd .gtd` for a clean tree.\n"
const FMT_RESTORED =
  'restored the retained history — HEAD is back at %s ("%s"), resting at "%s". Resume ' +
  "with the loop, or `git reset` to any earlier turn to restart from there.\n"

/** `no gtd process is underway (resting at "<initial>") — nothing to abandon` — `gtd abandon`'s no-op plain-text line. */
export const abandonNoopText = (initial: string): string => renderFormat(FMT_ABANDON_NOOP, initial)

/** A landed self-loop/target-change transition. */
export const transitionOutcome = (from: string, to: string): string =>
  printfLine("%s %s → %s\n", ["'->'", shellQuote(from), shellQuote(to)])

/** A bare capture (a self-loop commit). */
export const commitOutcome = (subject: string): string =>
  printfLine("%s %s\n", ["'[commit]'", shellQuote(subject)])

/** One already-rendered plain line. */
export const noteOutcome = (text: string): string => printfLine("%s\n", [shellQuote(text)])

/**
 * Resolves the post-hoc short hash/subject from `head` (a commitish) in-script
 * — this line runs AFTER the reset that made `head` the new HEAD, so neither
 * value is knowable when gtd generates it.
 */
export const abandonedOutcome = (from: string, head: string, state: string): string =>
  printfLine(FMT_ABANDONED, [
    shellQuote(from),
    `"$(git rev-parse --short ${shellQuote(head)})"`,
    `"$(git log -1 --format=%s ${shellQuote(head)})"`,
    shellQuote(state),
  ])

/** `gtd abandon`'s no-op outcome — the same wording `abandonNoopText` renders. */
export const abandonNoopOutcome = (initial: string): string => noteOutcome(abandonNoopText(initial))

/** Resolves the post-hoc short hash/subject from `to` (a commitish) in-script, for the same reason `abandonedOutcome` does. */
export const restoredOutcome = (to: string, state: string): string =>
  printfLine(FMT_RESTORED, [
    `"$(git rev-parse --short ${shellQuote(to)})"`,
    `"$(git log -1 --format=%s ${shellQuote(to)})"`,
    shellQuote(state),
  ])
