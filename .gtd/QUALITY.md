## correctness: a silently failing task vanishes from the signature

`scripts/test-states.ts` `failureSignature` (lines 76-86) now drops a task's
cache line, echo lines, blank lines and turbo's `ERROR command … exited (N)`
line. A task that fails without printing anything of its own therefore adds
nothing to the signature, not even its name. Under `errors-only` a task block
appears only when that task failed, so its presence is the only evidence it
failed. With it gone, two states with different sets of failing tasks can get
the same signature:

- state A: `lint` fails with `real error`
- state B: `lint` fails the same way, and `typecheck` also fails silently

B's signature equals A's (checked:
`failureSignature(x, t) === failureSignature(x + y, t)` is `true`). So B is
reported as `FAIL (same failure as A)`, and `typecheck`'s failure in B never
shows. Before this change the normalised cache line kept `typecheck` in B's
signature. This breaks the change's own promise that a boilerplate-only failure
is "always shown in full, never collapsed": here it is collapsed into another
task's failure.

Fix: record every task that has a block, even one with no remaining lines (for
example a `typecheck:` marker entry in `byTask`). Return `""` only when every
recorded task kept zero lines. Add a test where a second state differs from the
first only by an extra boilerplate-only task, and assert it is not collapsed. No
current test fails if a task's block is dropped entirely.

## correctness (Nit): the fixed echo count of 2 assumes npm's exact preamble

`echoes.set(task, 2)` assumes every task's output opens with exactly two `> `
lines (npm's `> pkg@ script` / `> command`). That holds for today's `TASKS`,
since none has a `pre`/`post` script. If a task gains a `pre<task>` script, npm
prints four echo lines. The extra two then survive into the signature, a
boilerplate-only failure gets a non-empty signature, and it can be collapsed
again. If a runner prints fewer than two, the task's first real `> ` line is
eaten. Consider matching npm's own echo shape (`> <name>@<version> <script>`
followed by the command line) instead of counting. Or add a test that pins "no
TASKS entry has a pre/post script", so the assumption fails loudly.

## ponytail-review: the `ERROR … exited (N)` filter never sees real input

What this change does: `failureSignature` now drops turbo's own lines (the cache
line, npm's two `> ` echo lines, blanks, and the `ERROR command … exited` line).
A failure that prints nothing of its own gets an empty signature, so it is
always printed in full and never reported as "same failure as". Load assumed:
one developer or one CI job running `npm test`.

Should fix:

1. **Dead filter, tests built on a fake log** (`scripts/test-states.ts:85`,
   `tests/tooling/test-states.test.ts:311,434`)
   - **What this is:** The line
     `if (/^\s*ERROR\s+command \(.*\) .* exited \(\d+\)$/.test(body)) continue`
     drops turbo's per-task error line from the signature.
   - **Problem:** turbo 2.10.9 writes that line to STDERR, not stdout (checked
     with and without `GITHUB_ACTIONS`/`CI`: 0 hits in stdout, 2 in stderr).
     `spawnTurbo` only captures stdout
     (`stdio: ["inherit", "pipe", "inherit"]`), so this branch never runs on a
     real log. The unit tests `tail` and the `runStates` "never collapses"
     fixture put the line into stdout, a shape real turbo never produces. The
     real-turbo test (`is empty when the task prints nothing…`) already passes
     without it.
   - **Fix:** Delete the ERROR branch and the `tail` / fixture ERROR lines. If a
     guard is wanted, it is the real-turbo test that already exists.
   - **If we skip it:** Readers trust a filter and fixtures that describe a log
     that does not exist; a future change tuned against those fixtures can break
     the real case unnoticed.

Nice to have:

2. **Duplicate test** (`tests/tooling/test-states.test.ts:324-327`)
   - **What this is:** "is empty for two boilerplate-only stdouts with differing
     hashes".
   - **Problem:** Each assertion is the `it.each` case above it with another
     hash; "both empty" says nothing the single case does not. The cross-hash
     property is already pinned by "keeps one real diagnostic, equal across
     states with differing hashes".
   - **Fix:** Delete the test.
   - **If we skip it:** Four extra lines to read and keep in sync.

Also agree with the correctness chunk above: a silent second failing task
vanishing from the signature is the one must-fix in this change.

Verdict: fix the correctness must-fix and 1 first. Lean: -8 lines possible.

## test-audit: tests that would not fail with the behaviour removed

Checked each new test by asking whether it fails when the code it guards is
removed. Most hold up: the `it.each` over the three cache phrases fails if any
regex branch is dropped; "keeps a task-printed `> ` line after the two echo
lines" fails if the count is 3 or if all `> ` lines are dropped; the
boilerplate-only case fails if the count is 1. Both real-turbo tests pass and
are the strongest owners. The suite passes (63 tests).

Should fix:

1. **No test for the case the correctness chunk found** (two failing tasks, one
   of them silent). Removing a task's block from the signature completely fails
   no test. The fix for that must-fix needs its own test: state B = state A plus
   a second, boilerplate-only failing task, and assert B is not
   `same failure as` A.

2. **The ERROR filter is covered only by made-up logs**
   (`tests/tooling/test-states.test.ts` `tail`, and the `runStates` `boiler`
   stdout). Removing the ERROR branch fails those tests, but only because their
   stdout contains a line real turbo writes to stderr (see the ponytail chunk).
   That is a fixture that invents a log shape, not proof. Same fix as ponytail
   item 1: drop the branch and the ERROR lines; the real-turbo
   `is empty when the task prints nothing…` test then owns the contract.

Nits:

3. **`echoes.set(task, 0)` has no test** (`scripts/test-states.ts:86`). It only
   matters when a real line comes before both echo lines are used up. Removing
   it fails no test. Either add a case (cache line, one `> a`, a real line, then
   `> quoted`, and assert `> quoted` is kept) or delete the line if that order
   cannot happen.

4. **"never collapses a boilerplate-only failure" (`runStates`) repeats two
   other tests.** "prints both failures when signatures are empty" already pins
   that an empty signature prints in full, and the failureSignature `it.each`
   pins that boilerplate gives an empty signature. This test adds only the two
   put together, and uses the fake ERROR line. Delete it, or keep it without the
   ERROR line if the combined check is wanted.

5. Agree with ponytail item 2: "is empty for two boilerplate-only stdouts with
   differing hashes" repeats the `it.each` case.

## conventions: the fake turbo log has no live twin holding it honest

Rule (AGENTS.md, Testing): "reach every external resource (… a spawned program)
through a port with a live and an in-memory implementation, and hold the two
together with a contract test that runs the same cases against both."

`runStates` takes a `TurboRun` (the in-memory side; `spawnTurbo` is the live
side). The change adds a new in-memory case, the `boiler` stdout in "never
collapses a boilerplate-only failure", plus the `head`/`tail` fixtures for
`failureSignature`. No case runs the same input against both sides. The two new
real-turbo tests check `failureSignature` on live output, but they never compare
it with the fixtures. That gap is how the fixtures got the `ERROR … exited (N)`
line on stdout, which real turbo writes to stderr (see ponytail item 1). A
contract case would have caught it.

Fix: make the boilerplate case one shared contract case. Assert that the fake
stdout and `realRun("exit 1")()` both give `""`. Or build the fake from the
captured live shape. Then delete the ERROR branch and the ERROR fixture lines
together, as ponytail item 1 says.

## conventions (Nit): the comment and doc credit npm's echo lines to turbo

Rule (AGENTS.md, Comments): keep a comment "only where it explains an important
decision… as short as the fact allows". Rule (Documentation): docs tell a user
what the code cannot. Both need to be accurate.

- `scripts/test-states.ts:65` says "Remaining turbo `> ` echo lines". The two
  `> ` lines are npm's script echo (`> pkg@ script`, `> command`), not turbo's.
  The correctness Nit's pre/post-script fragility follows from exactly that. Say
  "npm's two `> ` script-echo lines after turbo's cache line".
- `docs/development.md` says "prints nothing beyond turbo's own lines". The
  dropped lines are turbo's cache line plus npm's echo, so write "beyond turbo's
  and npm's own preamble". Otherwise a contributor whose task fails silently,
  except for an npm `pre` script's echo, reads a promise the code does not keep.
