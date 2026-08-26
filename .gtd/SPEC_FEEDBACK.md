# Spec feedback — package 02 (landing script is only the commit)

Requirements A and B are implemented, the suite is green, and every finding from
the previous round is fixed. Two things are still wrong, both in test files the
package's own tasks name: a scenario whose stated mechanism was deleted by this
package and now proves nothing, and a scenario title plus step phrase that name
a command form the package made impossible.

## 1. `tests/integration/features/ansi-free-stdout.feature` is now vacuous (blocking)

Task 2's fifth bullet asks only that this file pass, and it does — but its
`gtd land` leg lost the coverage it existed for, and its comment states the
deleted mechanism as live.

- **Lines 82-85 and 114-117 (both tiers) claim a mechanism that is gone:**
  "`gtd land` prints the required/optional outcome-carrying script — the one
  place ANSI source text (`printf '\033[...'`) appears anywhere in gtd's output
  — as plain source characters, never a real ESC byte." Plain `gtd land` prints
  `landProseText`'s one sentence now. No script, no `printf '\033[...'` source,
  nothing to escape.
- **The assertion is now vacuous.** `When I run gtd land` at that clean
  `checking` rest matches the `"C"` row, so `result.subject !== null` and stdout
  is the prose. `driveLandWrite` restores the plain call's `lastResult` before
  the assertion runs, so `stdout contains no ANSI escape sequence` checks a
  fixed 40-character sentence with no interpolated ANSI source anywhere in it.
- **The real coverage is lost, not moved.** Nothing left in this feature
  exercises a command whose plain stdout carries `printf '\033[...'` source.
  `gtd --entry <state>`, `gtd abandon` and `gtd restore` still print that script
  plainly (the package's own "Out of scope" section keeps them that way) and
  none of them appears in either scenario.

Rewrite both scenarios: keep the prose leg (that IS Task 2's bullet — the prose
must carry no escape sequence), and add a leg over a command that still prints
the script plainly, or over `gtd land --sh`, so the ESC-byte check has a subject
again. Rewrite the comment either way — do not leave a scenario whose stated
mechanism this package deleted.

## 2. `tests/integration/features/land.feature:291-292` names a form that no longer exists

The scenario is titled `gtd land | bash lands the turn in one pipe` and its step
reads `When I run gtd land piped to bash`. Neither is true any more.
`runGtdLandPiped` (`tests/integration/support/world.ts:432`) runs
`gtd land --sh`, `eval`s the document, then pipes `$gtd_script` into **`sh`** —
not bash, and not a bare `gtd land`. `land.feature` is one of Task 4's own
paths, and `src/Install.ts:248` and `docs/driver.md` both now warn a reader away
from exactly the one-liner this title advertises.

Rename the scenario and the step phrase to the capture-then-pipe `--sh` form
they actually run.
