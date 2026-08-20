/**
 * The whole exit-code vocabulary a driver, or a human at a terminal, reads
 * off gtd's process exit — CLOSED at these five numbers, one per row of the
 * table this module IS:
 *
 * | Code      | Meaning       |
 * | --------- | ------------- |
 * | 0         | success       |
 * | 1         | runtime error |
 * | 2         | usage error   |
 * | 130 / 143 | SIGINT / SIGTERM |
 *
 * PURE const data — no git, no Effect, no filesystem, no import at all: the
 * same zero-import-leaf tier as `StateFields.ts`. gtd's exit code no longer
 * says whose turn is next — that's `gtd next --json`'s own `kind` field — so
 * this module carries no behavior any more, only the closed set a test pins
 * against. Every command follows this table uniformly: 0 on success, 1 on
 * refusal, 2 on usage error, 130/143 when gtd itself dies by that signal.
 */
export const EXIT_OK = 0
/** Something failed that was never a matter of how gtd was invoked — a refusal or an unexpected error. */
export const EXIT_RUNTIME_ERROR = 1
/** gtd was invoked wrong — an unknown option/command, bad arity, a scope violation, a decode failure. */
export const EXIT_USAGE_ERROR = 2
/** The process was interrupted (Ctrl-C). */
export const EXIT_SIGINT = 130
/** The process was asked to terminate. */
export const EXIT_SIGTERM = 143

/** Every code this module recognizes — the CLOSURE claim a test pins against. */
export const EXIT_CODES: ReadonlySet<number> = new Set([
  EXIT_OK,
  EXIT_RUNTIME_ERROR,
  EXIT_USAGE_ERROR,
  EXIT_SIGINT,
  EXIT_SIGTERM,
])
