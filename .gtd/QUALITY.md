## correctness: the restack rollback trusts its own steps

`claude/hooks/ship.ts` `restackOf` → `run`, backstop loop (~l.1027-1046).

- The rollback calls `ok("update-ref", …)` per lower branch and
  `ok("reset", "--keep", preHead)`, discards both results, then reports "the
  restack is undone and nothing was pushed or recorded". A failed `update-ref`
  (ref lock) or `reset --keep` leaves the slice branches rebased while the
  record stays as it was. That is the broken chain the backstop exists to
  prevent: the next ship silently drops the stack, and the message has already
  said nothing changed. Check each result and, on failure, say which ref is
  still rebased, giving the `git update-ref` / `git reset --keep` line to run by
  hand.
- `--update-refs` moves every local ref that points into `<from>..<branch>`, not
  only the slice branches (a backup branch on a slice commit, say). The rollback
  restores only `lower` and HEAD, so "undone" overstates what it did for those
  refs. FYI. Narrow the claim, or snapshot `git for-each-ref refs/heads` before
  the rebase.
- The test cannot catch a broken restore. `three` has one lower branch and
  scripts `git rev-parse refs/heads/feat/x-middle` to `S2` before and after the
  rebase, so the asserted `git update-ref refs/heads/feat/x-middle S2 S2` still
  passes with the old/new arguments swapped, or with `pre` read after the
  rebase. No case restores a lower branch that DID move while another was
  skipped, which is the point of the rollback. Add a four-slice case (two lower
  branches): the rebase moves one and skips the other, and the test asserts
  `update-ref <moved> <pre-sha> <post-sha>` with distinct shas.

## correctness: the worktree precheck misses a branch mid-rebase elsewhere

`checkedOutElsewhere` reads only `branch refs/heads/<b>` lines from
`git worktree list --porcelain`. I checked this against real git 2.54: a
worktree in the middle of a rebase (or bisect) of `feat/x-middle` lists as
`detached`, so the precheck passes. `git rebase --update-refs` still skips that
branch: the rebase exited 0 and `feat/x-middle` stayed put. The backstop catches
it, so no stack is lost. But:

- the refusal is the backstop's version, with no worktree path, because the same
  parser finds nothing to name
- with a squash earlier in the same run, the squash is kept, which contradicts
  "refuses, with nothing changed" in `README.md` and `docs/driver.md` for "a
  slice branch checked out in another worktree"

Non-blocking. Either parse the rebase/bisect state of each worktree (its
`rebase-merge/head-name`), or soften the docs to "checked out (or being rebased)
in another worktree" and accept the backstop path.

## correctness: new io argv tested only against the scripted fake

FYI, mock/live drift. `git worktree list --porcelain` parsing,
`git rev-parse --git-path rebase-merge` + `test -d`, the explicit-refspec fetch
and the silent skip by `--update-refs` that the backstop relies on are all
pinned only by `ship.test.ts`'s scripted repository. No test runs any of them
against real git. The fake answers every unscripted argv with exit 0 and empty
output, so any failing-rebase test that scripts `GITPATH` takes "rebase in
progress" for granted. A real-git check (above) confirms the parser's format,
the relative `.git/rebase-merge` resolved from the root `cwd`, and the skip, so
nothing drifts today. Nothing would flag it if a later git changed any of these.
A small real-git contract case covering the skip, the backstop and the rollback
would close the gap.

## ponytail-review: the worktree refusal prints an unquoted path

`claude/hooks/ship.ts` `restackOf`, the `checkedOutElsewhere` refusal (~l.993).

- Nice to have. The refusal tells the user to run
  `git -C ${held.path} switch --detach`, with the worktree path pasted in bare.
  A worktree at `/Users/me/My Projects/x` gives
  `git -C /Users/me/My Projects/x switch --detach`, which fails when copied as
  is. Quote the path in the message (`git -C '<path>' switch --detach`); the
  test's expected string changes with it.
- Otherwise this lens agrees with the correctness notes above and adds nothing:
  `from` read off the recorded top is safe because `recordStack` writes the top
  before the names; the hand-restack `<lowest>~1` test only assumes one commit
  per lower slice, which `chain` already assumes; the retarget preview moved to
  `stackPreview` with a test pinning exactly one line. Load assumed: one person
  running `/gtd ship` in one repository.

## test-audit: the scripted `git worktree list` never lists the current worktree

`claude/hooks/ship.test.ts` "review round 1", and `three`/`two`.

- Real git always lists the current worktree, with `branch refs/heads/feat/x`.
  The fake answers an unscripted `git worktree list --porcelain` with empty
  output, so every happy-path test runs the precheck against no worktrees at
  all. The one fixture that lists any (`elsewhere`) also holds `feat/x-middle`,
  which the loop finds first. So `restackOf`'s `l.branch !== branch` filter is
  not pinned by the precheck tests: drop it and they all still pass. It is
  caught only by accident, through the backstop and the fake's exit-0 default
  for `merge-base --is-ancestor <from> refs/heads/feat/x`. Non-blocking. Give
  `three` and `two` a default `[WT]` entry listing `/repo` on `feat/x`, so the
  happy path checks the real shape.
- The backstop's `(checked out in worktree <path>)` suffix has no case. Every
  rollback test leaves `WT` unscripted. FYI.

## test-audit: call-shape and duplicate assertions in "review round 1"

- "a hand restack reads the recorded top once" counts
  `git config --local --get <top>` calls. That is call shape, not behaviour: an
  extra read changes nothing a user sees, and a refactor that reads twice should
  not fail a test. Delete it.
- "fetches an explicit refspec, never the bare form, then rebases onto
  origin/main" repeats what is already pinned elsewhere. The updated order test
  covers FETCH before the rebase, and "a failed fetch refuses" pins the argv
  with `toEqual`. Delete it, or fold the `not.toContain` into the order test.
- "a diverged local merged slice branch is never the rebase base" is carried by
  its rebase-argv assertion. The second assertion, that no command mentions
  `refs/heads/feat/x-refactor`, pins how the code reads refs, not what it does.
  The same goes for "a stale local merged branch does not stop a hand restack".
  Drop the `refs/heads/feat/x-refactor` greps.
- "recordedRefusal's dry call plans no restack" names an internal function and
  promises "no … worktree list". The `two` fixture has no lower branch, so the
  worktree read is unreachable whatever `planRestack` says. The ls-remote half
  does guard the change: without `planRestack=false`, the offline `lsTop` would
  surface. Rename it after the behaviour ("a live record refuses even when
  origin is unreachable") and drop `worktree` from the regex, or use `three`.
- The rollback-restore weakness (S2 before and after, so swapped `update-ref`
  arguments still pass) is already raised under correctness. This lens agrees,
  and holds that the `update-ref … S2 S2` assertion pins no restore.

## conventions: new external calls reach git only through an untwinned port

`claude/hooks/ship.ts` `checkedOutElsewhere` and `restackOf`'s `run`.

- AGENTS.md: "reach every external resource (git, a shell, a file outside the
  repository, the network, a spawned program) through a port with a live and an
  in-memory implementation, and hold the two together with a contract test that
  runs the same cases against both." The change adds
  `git worktree list --porcelain`, `git rev-parse --git-path rebase-merge`, a
  spawned `test -d`, an explicit-refspec `git fetch` and `git update-ref` /
  `git reset --keep` through `ShipIo.run`. Its live side (`shipIo` in
  `claude/hooks/register.tsx`) and the scripted fake in `ship.test.ts` share no
  contract test, so nothing holds the fake's answers to real git. This is the
  rule-level form of the correctness lens's "tested only against the scripted
  fake" FYI. Here it is a convention violation: add a contract case that runs
  the worktree-list parse, the rebase-merge probe and the `--update-refs` skip
  against both.
- `test -d <dir>` spawns a program to answer a filesystem question. Asking git
  directly (`git rev-parse --verify --quiet REBASE_HEAD` is already read, or
  `ok("rev-parse", "--git-path", …)` plus an existing file read on the port)
  avoids one more untwinned external call. Non-blocking.

## conventions: no cucumber scenario for the new refusals

- AGENTS.md: "create cucumber.js scenarios for each new feature, tagged
  `@inmem`." The change adds three user-visible behaviours, all documented in
  `README.md` and `docs/driver.md`: the refusal when the lowest PR merged into a
  non-default base, the worktree refusal (also under `-n`), and the backstop
  rollback. No `.feature` covers `/gtd ship` at all, so this follows existing
  practice for `claude/`. It still breaks the rule as written. Either add
  `@inmem` scenarios, or treat `claude/` as exempt and record that where the
  rule lives. Flag for the human. Not fixable inside this lens.

## conventions: comments and test names

- AGENTS.md (Comments): "Everything else (restatement of the code, history, a
  'what' with no 'why') gets deleted." In the `stackRest` comment, "No top means
  no `from`." restates the ternary below it. Delete that sentence; the first one
  carries the why.
- `describe("review round 1", …)` in `ship.test.ts` names the review round that
  produced the tests, not the behaviour they pin. That is history in a name.
  Under the same rule's spirit it should be renamed after what it covers (e.g.
  "restack after a merged lower slice"). Non-blocking.
- The "recordedRefusal's dry call …" test name naming an internal function is
  already raised under test-audit. This lens agrees and adds nothing.
- Docs side is clean: the `README.md` and `docs/driver.md` additions name no
  `src/*.ts` module or internal function, the README reflects the change as the
  global CLAUDE.md asks, and the doc-tested "A complete minimal driver" section
  is untouched.

## spec-challenge: concern 7 lets a fresh stack replace a live hand-restacked record

Decision (ARCHITECTURE.md, concern 7, and its Answered Question "With
hand-restack checks skipped in `recordedRefusal` …"): the dry `resumable` call
from `recordedRefusal` passes `planRestack=false`, which skips `handRestack`
entirely. Risk was "accepted".

Invariant it breaks: `docs/driver.md` (~l.405) promises "A fresh multi-slice
stack ship on a branch whose recorded stack is still live refuses too … (a
record that no longer chains to HEAD is dropped, not refused)". A hand-restacked
record is live: the same doc says the next `/gtd ship` adopts it and keeps the
stack. At `daee504c`, `recordedRefusal` ran `handRestack` and refused. Now
`resumable` hits `valid && "rebased" in guard`, returns `{ forget: true }`, and
the fresh ship overwrites `gtdStack`/`gtdStackTop`. The remaining slice PRs stay
open and orphaned, and the docs were not updated to say so. No test covers this
path in either direction.

- Blocking. Concern 7 only needed to keep the dry call off the network
  (`ls-remote`) and away from restack refusals. `handRestack`'s shape test is
  local: `from` off `lowest`, plus `<lowest>~1` on `origin/<default>`. Run that
  shape test under `planRestack=false` and skip only `originLeases`, so a
  hand-restacked record still refuses a fresh stack. Add a test: hand restack,
  then a fresh multi-slice ship, which refuses with the "already has a recorded
  stack" text and runs no `ls-remote`.
- If the human holds to "skip entirely", the driver.md sentence must say that a
  hand-restacked record is replaced, not refused.

## spec-challenge: concern 3 contradicts the "skips a merged lower slice" doc line

Decision (concern 3): a `MERGED` slice counts as done only when `baseRefName`
equals the default branch. Any other base refuses in `mergedSlices`, and
`mergedSlices` runs on every resume and every single-slice re-ship.

Invariant: `docs/driver.md` (~l.402) still says "a resume or a single-slice
re-ship skips a merged lower slice instead". That holds now only for a slice
merged into the default branch. The new restack sentence (~l.433) covers the
restack, but not the single-slice re-ship or a resume with no restack. Both now
refuse too. Non-blocking. Qualify the l.402 clause ("… merged into the default
branch …").
