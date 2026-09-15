import type { StateName } from "../PatternMachine.js"

/**
 * The core's git effect, as DATA — never shell text. `src/GitScript.ts` is
 * the only place a `GitWrite` becomes a command; `src/step/` never imports
 * that module, which is what makes writing a live git call inside the core
 * impossible rather than merely discouraged.
 */
export type GitWrite = { readonly kind: "commitAll"; readonly message: string }

/** A landed step's trailing report, rendered by `GitScript.ts` into a `printf` line. */
export type Outcome =
  | { readonly kind: "transition"; readonly from: StateName; readonly to: StateName }
  | { readonly kind: "commit"; readonly subject: StateName | string }
  | { readonly kind: "note"; readonly text: string }

/**
 * One step of a landing script, as DATA — no step carries a literal shell
 * string; `GitScript.ts`'s `ScriptSurface` is the only place any of these
 * becomes shell text (and the only place a bare path becomes a quoted
 * argument). `"uncheck"` is the human-review-gate's reset command
 * (`gtd uncheck <file>`, ahead of the commit); `"command"`'s own `command`
 * is a driver-facing shell fragment `src/step/` never constructs today (no
 * current emitter produces one) but the shape stays available for a future
 * step that genuinely needs an arbitrary command.
 */
export type LandStep =
  | { readonly kind: "gitWrite"; readonly write: GitWrite }
  | { readonly kind: "uncheck"; readonly file: string }
  | { readonly kind: "command"; readonly command: string; readonly onFailure?: string }
  | { readonly kind: "outcome"; readonly outcome: Outcome }
