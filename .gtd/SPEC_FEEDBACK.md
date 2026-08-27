# Spec feedback — 01 — The four-command suite, with agent and models chosen by asking

**One problem: `README.md` still tells users `gtd install` builds TWO
commands.** Every task checkbox in the package is otherwise satisfied and the
full suite is green (`npm test`, plus a forced `src/Install.test.ts` run:
35/35).

## `README.md` lines 258–266 contradict the new briefing

The briefing now installs four commands (`gtd-build`, `gtd-edit`, `gtd-review`,
`gtd-fix`). The README's "Then let an agent build your own" section still says:

- line 259 — "build **two commands** for itself"
- line 261 — "The **two commands**: a **loop command** that drives beats until
  the process rests, and an **edit command** …"

**A user reading this gets a wrong count and a dead name.** "Loop command" is
the `gtd-loop` framing this package deliberately retired — `docs/driver.md`'s
four mentions were renamed to `gtd-build` for exactly this reason, and the
package's own acceptance note says the alternative is that "the docs contradict
the briefing". They now do, one file over.

**Fix:** rewrite that paragraph to name the four commands and what each does —
`gtd-build` drives beats until the process rests, `gtd-edit` opens the steering
file the process is waiting on (falling back to `.gtd/TODO.md`),
`gtd-review <commitish>` starts a review round over that commitish and drives
it, `gtd-fix` enters the fix process and drives it. Keep the existing
`.gtd/TODO.md` fallback sentence that follows — it is still correct and still
load-bearing as the "how you begin" hook.

**No other package owns this.** `02-reinstall-detect-upgrade.md` and
`03-editor-integration.md` both scope to `src/Install.ts` and
`src/Install.test.ts` only, so the README stays wrong for the rest of the build
unless it is fixed here.

**Do not rename `.git/gtd-loop.log`** while editing — unchanged per this
package's own risk note. The `gtd-loop` strings left in
`tests/integration/features/driver-doc.feature` and
`tests/integration/support/steps/driver-doc.steps.ts` are stub-output text and
temp-dir names, not the command name; leave them alone too.
