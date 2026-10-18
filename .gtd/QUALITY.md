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
