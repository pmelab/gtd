export const EXIT_OK = 0
/** Something failed that was never a matter of how gtd was invoked — a refusal or an unexpected error. */
export const EXIT_RUNTIME_ERROR = 1
/** gtd was invoked wrong — an unknown option/command, bad arity, a scope violation, a decode failure. */
export const EXIT_USAGE_ERROR = 2
export const EXIT_SIGINT = 130
export const EXIT_SIGTERM = 143

/** Frozen: adding a code is a driver-protocol break, the same as removing a wire field. */
export const EXIT_CODES: ReadonlySet<number> = new Set([
  EXIT_OK,
  EXIT_RUNTIME_ERROR,
  EXIT_USAGE_ERROR,
  EXIT_SIGINT,
  EXIT_SIGTERM,
])
