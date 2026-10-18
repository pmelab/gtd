# Quality findings

## correctness: a branch rebased after its lower slice merged is now refused instead of shipped

`claude/hooks/ship.ts` `topGuard` sets
`what = "A merged slice's commit cannot be found"` whenever `from > 0`, so ANY
resume with a merged lower slice requires the recorded top (`gtdStackTop`) to be
an ancestor of HEAD, even when no slice branch is missing. The common follow-up
to merging the bottom PR is `git rebase main`: a one-commit slice squash-merged
upstream is patch-identical, so the rebase drops it and rewrites the top, and
the recorded top is no longer in HEAD. That path now returns "A merged slice's
commit cannot be found and HEAD no longer contains the recorded top of the
stack; nothing changed", both in the no-process resume (`plan` →
`resumable(…, "HEAD")`) and in the new one-slice squash (`stackReads` →
`resumable(…, base)`). Before this change the same repo went through `chain`:
the lower branch no longer chained to HEAD, so the record was dropped and the
branch shipped alone, with the PR moved back to the default branch. A one-slice
stack-mode ship used to always drop the record. So a normal "merge bottom,
rebase, ship" flow now needs a manual `GTD_SHIP_MODE=commits`. And when the
rebase leaves no upper branches to check (`done === last`), `chain`'s loop is
empty and `valid` stays `true`, so the only rebase check left is this refusal.
Fix: refuse only when an unmerged slice branch is missing. When only the merged
floor needs the top and HEAD no longer contains it, either fall back to
`merge-base` (leave `floor` undefined) or take the existing "no longer chains →
ship alone" path. Add a test with `MERGED` lower, branches present, and
`merge-base --is-ancestor <top> HEAD` failing. No test covers that combination
today: "a recorded top that is not an ancestor of HEAD refuses" uses
`lowerGone`, an unmerged missing branch.

## correctness: a non-open top PR on a resumed stack names a remedy that also fails

`mergedSlices` gives the same refusal for every non-open PR at or above `done`,
the top branch included: "…a closed one needs GTD_SHIP_MODE=commits to ship the
branch alone." For the top slice (`i === last`, the branch itself) that advice
is wrong. Commits mode reaches `pullRequest`, which refuses again ("The pull
request for <branch> is MERGED, not open"). `docs/driver.md` and `stackPrecheck`
both say a merged or closed top PR needs a renamed branch. The wording is the
same as the deleted `settle`, but `settle` only ran on the no-process resume.
`mergedSlices` now also runs on every one-slice stack-mode ship with a recorded
stack, which before this change dropped the record and reported the accurate
`pullRequest` refusal. Fix: branch the text on `i === last`, as `stackPrecheck`
does ("Rename the branch").

## correctness: the new git and gh semantics are checked only against a scripted io, with no live contract

The ship tests' `repo` answers every unscripted argv with exit 0 and empty
output. Each new behaviour is asserted only as an exact argv string:

- the floor and missing-branch fallbacks read `<top>~n` and assume the recorded
  top is the last slice commit of a one-commit-per-slice first-parent chain
- `topGuard` now uses `merge-base --is-ancestor <top> HEAD`
- `pullRequest` and `preview` now call `gh pr view <branch>` where they used to
  call bare `gh pr view`

Nothing runs these against a real repository or `gh`. Bare `gh pr view` resolves
the PR through the branch's upstream/push configuration. `gh pr view <name>`
matches any PR whose head ref has that name, so in a fork setup it can find a
different PR than before. That PR is then edited (retargeted, body rewritten) or
wrongly read as `MERGED`/`CLOSED`. A wrong `~n` count, for example after a
`.gtd/`-only slice folds or an extra commit lands between slices, would pass the
suite unchanged. Consider adding a small real-git test of the `<top>~n` floor
and revive, and pinning the `gh pr view <branch>` choice (or passing
`OWNER:BRANCH`) with a comment on why the branch argument is safe.

## owasp-security: brace expansion still gets `--output` past the shipper's read-only git allowlist

[HIGH] Arbitrary file write from the shipper subagent (CWE-78, OWASP A05:2025
Injection, LLM01 Prompt Injection, ASI02 Tool Misuse & Exploitation)

`claude/hooks/ship.ts` `READ_ONLY_GIT` now lets quotes and backslashes through
the `-o`/`--ou` lookahead, and the new comment says this is because "the shell
strips them". But the shell does more than strip quotes, and the regex still
allows `{ } * ? [ ]`. `register.tsx` tests the raw Bash command against the
regex, and the Bash tool's shell (bash, zsh or fish) then expands it. Confirmed
by running both the regex and the shells: `git log -1 {--output=OUT,--oneline}`
and `git log -1 {,--output=OUT}` both match `READ_ONLY_GIT`, and both bash and
fish then write `OUT`. A glob such as `-*utput=x` also gets through when a file
with that name is in the cwd.

Path: someone who can put a commit on the branch writes text in its message →
the shipper reads it on purpose (that is why the allowlist exists) → an injected
instruction gets `git log -1 <sha> --format=%B {--output=.git/config,HEAD}` past
the PreToolUse check → the body the attacker controls lands in `.git/config`
(e.g. `core.fsmonitor = <cmd>`). The user's next git command then runs `<cmd>`.
That is code execution on the user's machine, from a commit message. The only
step not proven is that the model follows the injection, so the confidence is
Likely, not Confirmed.

Fix: add the expansion characters to every excluded class
(`[^;&|<>\`$()\n]`→ also`{}*?[]`) instead of trying to model quoting. Add the brace and glob forms to the `bad`list in`ship.test.ts`.
No test there would fail today if the quote-transparency change were reverted to
a weaker regex for these inputs, because none of the cases uses expansion.

[MEDIUM] `git diff --no-index` reads any file the user can read (CWE-200, OWASP
A01:2025 Broken Access Control, LLM02 Sensitive Information Disclosure). This
predates the change, but it is the same control.
`git diff --no-index ~/.ssh/id_ed25519 /dev/null` matches `READ_ONLY_GIT`, as
confirmed above with `/etc/hosts`. An injected instruction can pull a secret
into the shipper's context and then into the PR body that ship publishes. Fix:
refuse `--no-index` (and `--ext-diff`/`--textconv`, which run configured
programs) in the lookahead. Confidence: Likely, for the same reason as above.

## ponytail-review: a test named "two re-ships in a row" runs no sequence and repeats two other tests

`claude/hooks/ship.test.ts`, "two re-ships in a row never move the top; a
deleted lower branch is rebuilt at its own commit". Each `repo(...)` is a fresh
scripted io with no state carried over, so the loop runs the same independent
ship twice: it is "the squash lands on the top branch and the stack is kept
untouched" again (that test already asserts `topWrites` is empty). The last part
uses `lowerGone` with the same completions and the same
`git branch -f feat/x-refactor <C1>` assertion as "a top that is an ancestor of
a later HEAD rebuilds from the top, not HEAD". Nothing here would fail that the
other two do not already catch, and the name promises a sequence check that does
not exist. Fix: delete the test, and move its one new line,
`expect(ran().some((c) => c.includes("HEAD~"))).toBe(false)`, into "a top that
is an ancestor of a later HEAD rebuilds from the top". About -12 lines.

## ponytail-review: `recordedStack` is a one-call wrapper

`claude/hooks/ship.ts` `recordedStack` has one caller, the last line of
`squash`, and only turns `recordStack`'s string into `fail(...)`. It was split
out of `squash`, not shared. Fix (nice to have): put the two lines back at the
call site. -4 lines.

## test-audit: "never its local ref" poisons a spelling the code never used, so reverting to the old floor still passes

`claude/hooks/ship.test.ts`, "a merged slice's commit is found off the recorded
top, never its local ref". It overrides only
`git rev-parse refs/heads/feat/x-refactor` (no `--verify --quiet`). The `merged`
fixture inherits `resume`, where
`git rev-parse --verify --quiet refs/heads/feat/x-refactor` still answers `C1`,
the same value `<top>~1` gives. The deleted `settle` took the floor from
`links[done-1].commit`, which `chain` read with exactly that `--verify --quiet`
spelling. So a regression back to "floor = the lower branch's local ref" (the
behaviour this test exists to rule out) still logs `C1..X` and passes. The same
gap applies to "a merged lower slice drops out of a resumed stack before any
push", whose `C1..C2` log assertion is the only other floor proof. Fix: poison
`--verify --quiet refs/heads/feat/x-refactor` with `"9".repeat(40)` too, so the
two ways of reading the ref disagree with `<top>~1`.

## test-audit: the merged-slice floor on a one-slice re-ship, and its "cannot be found" refusal, have no test

- `squashOntoStack` returns `floor: resume.floor`, and `stackPullRequests` uses
  it in place of `merge-base`. Every test in "a recorded stack resumed by a
  one-slice ship" has all PRs `OPEN` (`done === 0`), so the floor is always
  undefined there. Removing `floor: resume.floor` fails no test, and the top
  PR's description would then cover the merged slice's commits again. Add one
  `reship` case with `[view("feat/x-refactor")]: pr(7, { state: "MERGED" })` and
  `` `${C2}~1` `` → `C1`, asserting the log range starts at `C1` and the top PR
  is retargeted to `main`.
- `resumable`'s `if (done && !floor)` refusal ("The commit of merged slice …
  cannot be found; nothing changed") is not tested. No test scripts `<top>~n` to
  fail while a slice is `MERGED`. Add a case to the `merged` describe with
  `` `git rev-parse --verify --quiet ${C2}~1` `` → `{ code: 1 }` that asserts
  the refusal text and that nothing in `mutating` ran.
- The existing `test.each(["MERGED", "CLOSED"])` "a %s top PR refuses without
  pointing at commits mode" uses `sbase` (fresh stack) only. Running the same
  table over `reship` would pin the wrong remedy text the correctness lens found
  for a resumed stack's top PR.

## test-audit: duplicate refusal tests, a read-order test, and stale names after the mode switch

- "a recorded top that is not an ancestor of HEAD refuses with nothing changed"
  (`lowerGone` + `merge-base --is-ancestor C2 HEAD` failing) proves the same
  thing as the `test.each` row "HEAD no longer contains the top" in "a missing
  slice branch on resume" (`gone` + the same two scripted lines). The only
  differences are `HEAD = X` and a poisoned `HEAD~1`, and neither is read on the
  refusal path. Delete one of them. If the correctness fix (refuse a merged
  floor without a missing branch) lands, give the kept slot the
  `MERGED`-with-branches-present case instead.
- "every gh pr view precedes any ref probe" checks the order of reads relative
  to other reads. That is call shape, not observable behaviour. `topGuard` takes
  `done` from the PR states, so the order is a data dependency that a reorder
  could not keep anyway. The contract that matters, a non-open PR refusing with
  nothing changed, is already covered by "a closed lower slice refuses a resume
  before any push" and "a closed lower PR refuses before the history push".
  Delete the test.
- "a lower branch deleted before a one-slice re-ship is revived after the squash
  at <top>~n" does not assert `ok`, and it does not assert that
  `git reset --soft ${BASE}` ran. If the squash is skipped, `at(reset)` is `-1`
  and the `toBeGreaterThan` still passes. Add `toMatchObject({ ok: true })` and
  `at(reset) > -1`.
- Names that no longer match what the tests do:
  - "a failed git branch -f leaves a record that a second run rebuilds from
    HEAD": the second run now reads `<top>~1`, not `HEAD~1`.
  - "single-slice stack-mode ship defers the unset until after the retarget":
    now calls `ship(io, false, "commits")`. Rename both, for example "…rebuilds
    from the recorded top" and "single-slice commits-mode ship defers…".
