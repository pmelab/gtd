# Tests: new `tests/integration/features/squashing.feature`

Add cucumber scenarios for the Squashing state. Assert the PROMPT (the agent
action — authoring the message + running the squash — is external, exactly like
Clean scenarios assert the emitted prompt, not the authored REVIEW.md).

## Files

- `tests/integration/features/squashing.feature` (NEW)

Do NOT touch `journeys.feature` (task 04) or other feature files. Reuse the
existing composable `Given` steps — do NOT add new step definitions. Available
steps (see `tests/integration/support/steps/common.steps.ts` and
`gtd-state.steps.ts`):

- `a test project`
- `a gtd config file at {string} with:` (config.steps.ts)
- `a commit {string}` (empty marker commit)
- `a commit {string} that adds {string} with:`
- `a commit {string} that deletes {string}`
- `the working tree is committed as {string}`
- `a file {string} with:`, `{string} is modified to:`
- `When I run gtd`, `Then it succeeds`
- `the last commit subject is {string}`, `the git log contains {string}`
- `stdout contains {string}`, `stdout does not contain {string}`
- `the file {string} exists` / `does not exist`

## Scenarios

Squash defaults to `true`, so scenarios that expect squashing to fire need no
config; the disabled scenario sets `squash: false`. Note test repos with no
default-branch/merge-base fall back to whole-history — build histories that make
`firstGrilling` and `gtd: done` unambiguous.

1. **Happy path — Squashing prompt fires after `gtd: done`.** Build a full
   process history on a branch ending at `gtd: done`, e.g.:

   ```
   a commit "gtd: grilling" that adds "TODO.md" with: (a plan)
   a commit "gtd: planning" that deletes "TODO.md"
   a commit "gtd: building" that adds "src/calc.ts" with: (code)
   a commit "gtd: package done"
   a commit "gtd: awaiting review" that adds "REVIEW.md" with: (a review)
   a commit "gtd: done" that deletes "REVIEW.md"
   ```

   Then `When I run gtd` / `Then it succeeds` and assert stdout:
   - contains the Squashing section heading / key instruction (match the exact
     text authored in `src/prompts/squashing.md`),
   - contains `git reset --soft`,
   - contains the inlined full-process diff (`src/calc.ts`),
   - contains the auto-advance tail text (from `partials/auto-advance.md`, e.g.
     "Re-run gtd immediately"),
   - does NOT contain the STOP-tail text. (The agent action is external; assert
     only the prompt, like Clean scenarios.)

2. **Interleaved non-gtd commit is inside the squash range.** Same history but
   insert a `feat: coworker` commit that adds a file between two `gtd: *`
   commits (before `gtd: done`). Assert the Squashing prompt still fires and the
   inlined diff / `git reset --soft <base>` range spans the coworker commit —
   i.e. the coworker file appears in the inlined diff (base = parent of the
   first `gtd: grilling`, so the coworker commit is INSIDE the range). No abort,
   no guard.

3. **Squash disabled by config → Idle, no Squashing prompt.**

   ```
   a gtd config file at ".gtdrc" with:  squash: false  (plus testCommand: "true")
   ```

   Same `gtd: done` history. Assert `When I run gtd` succeeds and stdout
   contains the Idle prompt ("## Task: Nothing to do") and does NOT contain the
   Squashing section text.

4. **Already squashed / no gtd range → Idle, not Squashing (idempotence).** HEAD
   is a plain `feat:` boundary commit (no `gtd: done`, no `gtd: grilling` in the
   cycle). Assert `When I run gtd` succeeds and stdout contains the Idle prompt,
   NOT the Squashing section — running again does not re-squash (`squashBase`
   unset because there is no `gtd: done` at HEAD).

## Acceptance criteria

- [ ] `squashing.feature` exists with the four scenarios above.
- [ ] All scenarios use only existing composable `Given`/`When`/`Then` steps (no
      new step definitions).
- [ ] stdout assertions match the exact prompt text authored in
      `src/prompts/squashing.md` (verify against that file).
- [ ] `npm run test:e2e` passes with these scenarios green. NOTE: integration
      tests run the BUILT bundle (`scripts/gtd.bundle.mjs`); `pretest:e2e`
      rebuilds first, so the squash code from Packages 01/02 must be committed/
      present before running. If invoking cucumber directly, `npm run build`
      first.
