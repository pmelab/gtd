import { shellQuote } from "../GitScript.js"

/**
 * `src/ui/`'s own name for `GitScript.ts#shellQuote` — re-exported, not
 * reimplemented: wraps `value` in single quotes with every embedded single
 * quote escaped, the one quoting scheme `bash` interprets literally
 * regardless of what `value` contains (command substitution, a semicolon, a
 * backtick, all inert inside single quotes). `GitScript.ts` already owns
 * this escape and property-tests it against real `bash`; every place in
 * `src/ui/` that interpolates a client- or `.gtdrc`-supplied string into a
 * `runner.bash` command string runs it through here first, so there is
 * exactly one implementation to correct if this scheme ever needs to
 * change, never a second copy silently missing the fix.
 */
export const singleQuoted = shellQuote
