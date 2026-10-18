## correctness: the hand-restack path skips the checks the rebase path makes

Two code paths force-push the restacked slice branches. Only the rebase path
(`restackOf` in claude/hooks/ship.ts) guards that push. It reads origin's sha
with `git ls-remote`, refuses when origin holds commits the local branch lacks,
and leases each push on that sha. Its comment says why: "never origin/<b>: a
fetch rewrites that". The hand-restack path (`handRestack`) builds its links
with no `lease` and runs no ls-remote check. So `pushBranch` falls back to a
plain `--force-with-lease`, which leases on the remote-tracking ref. That is
exactly the case the rebase path was written to avoid. A user who just rebased
by hand has almost certainly run `git fetch` first. A collaborator's commit on
`origin/<branch>-<slice>` would then be force-pushed away without a refusal. The
test "pushes each branch with a lease, retargets the lowest PR and keeps the
stack" expects `git push --force-with-lease origin feat/x-middle`, so it pins
this gap. Both docs/driver.md ("pushes each with a lease") and the -n preview
line describe a guard that is not there.

The detection is also looser than its comment says. `handRestack` claims "the
remaining slice branches already sit on the default branch", but it only checks
that the merged slice's commit is no longer an ancestor of the lowest remaining
branch. It never checks
`merge-base --is-ancestor origin/<default> <lowest branch>`. An interactive
rebase that rewrote the merged slice's commit as well passes this check. It then
gets force-pushed and kept as the stack, and the retargeted PR shows the merged
slice's changes again.

Fix: send the hand path through the same ls-remote read, ancestry refusal and
explicit lease as `restackOf`, for example by sharing that block. Also require
`origin/<default>` to be an ancestor of the lowest remaining branch before
treating the rebase as a hand restack. Add tests: origin holds an unknown
commit, so the hand restack refuses; the lowest branch is not on
`origin/<default>`, so the record drops and the branch ships alone.

## correctness: half-written record after a restack re-rebases from the wrong base

`restacked` writes `gtdStackTop` first and `gtdStack` second. If the second
`git config` fails, the message says "/gtd ship picks that up", but the record
is now inconsistent: the new top is set and the old slice names (including the
merged one) are kept. On the next ship, `topGuard` accepts the new top because
HEAD contains it, so the hand-restack branch is skipped. `finishResume` then
computes `floor` as `<newTop>~2`, which lands on a default-branch commit, not
the merged slice. `restackOf` rebases again from the local `<branch>-<merged>`
ref, and that ref is no longer an ancestor of the branch. If `gtdStack` is
written first and the `gtdStackTop` write fails instead, the record stays safe:
`done` is 0, the stale top is not in HEAD, and it is only read for a
missing-branch rebuild, which `topGuard` already guards. Swap the two writes.
Add a test that fails the second write and asserts the retry pushes without a
second rebase.

## correctness: a retry after a failed restack push loses the explicit lease

The record shrinks before any push, as intended. But if a push then fails
(network, or a lease rejection on a later branch), the next ship sees `done` =
0, never calls `restackOf`, and pushes the already-rebased branches through
`pushBranch` with no `lease`. That falls back to the tracking-ref
`--force-with-lease`, and the "origin holds commits" refusal is skipped. The
retry still finishes the restack, but on the weaker guard this change set out to
replace. Consider making the done=0 resume path, for any link whose local commit
does not descend from its `origin/<b>`, use the same ls-remote check and
explicit lease. Or say in the failure text that the retry pushes with the
tracking ref.

## correctness: Nit: non-conflict rebase failure after a same-run squash drops the undo hint

In `restackOf`'s `run`, the "no rebase in progress" branch (old git rejecting
`--update-refs`, or any other failure before the sequencer starts) returns only
"git rebase failed; refs are unchanged." When `run(preShip)` follows
`squashOntoStack`, the squash has already been committed and the history ref
pushed. Unlike the conflict branch, this message does not print
`git reset --soft <preShip>`. Add the same `preShip` line there.

## correctness: FYI: -n decides "rebase vs retarget only" on an unfetched origin/<default>

The dry run skips the fetch, so
`merge-base --is-ancestor <from> origin/<default>` reads whatever the last fetch
left. Right after a lower PR was merged with a merge commit, if the user has not
fetched yet, `-n` previews a rebase and force pushes that the real run, which
fetches first, will not do. The reverse can happen too. A short note on the
preview line ("as of the last fetch of origin/<default>") would make this clear.

## correctness: mock/live drift: the restack is only tested against scripted git

Every new restack test scripts git in the `repo()` map. Nothing runs
`git rebase --update-refs --onto`, `git ls-remote` output parsing, or the
`REBASE_HEAD` conflict probe against a real repository. The three-slice fixture
also returns the pre-rebase sha for `git rev-parse refs/heads/feat/x-middle`
after the rebase. So the test cannot show that `restacked` re-reads moved refs,
nor that the `pushLink` "no longer points at" guard holds against the rebased
commit. I checked by hand that git 2.54 moves the middle branch as assumed. That
check is not a test, and the repository's own rule is a port with a live twin
plus a contract test. Add a live-git case, or a contract-tested in-memory git
twin, covering: a three-branch squash-merged restack (middle ref moves, record
shrinks), a conflicting rebase (`REBASE_HEAD` set, then `--abort` restores every
ref), and ls-remote output for a branch missing on origin.

## ponytail-review: lean and test gaps in the restack code

What this change does: re-running `/gtd ship` after a lower stacked pull request
was squash- or rebase-merged now fetches the default branch, rebases the
remaining slice branches onto `origin/<default>` in one
`git rebase --update-refs`, pushes each with a lease on origin's sha, retargets
the lowest pull request and shrinks the recorded stack. It also spots a rebase
the user did by hand after a conflict. Load assumed: one person running a CLI on
their own branch, so no scale findings. The correctness chunks above already
cover the hand-restack lease gap, the config write order, the retry lease, the
undo hint and the scripted-git drift; they are not repeated here.

**Should fix**

1. **Two fields of `Restack` are never read** (`claude/hooks/ship.ts`,
   `type Restack`, `restackOf`, `handRestack`)
   - **What this is:** `Restack` carries `onto`, `from`, `preview` and `run`.
   - **Problem:** Nothing reads `restack.onto` or `restack.from`; only `preview`
     and `run()` are used (grep shows no `.onto`/`.from` access). Both builders
     fill them anyway.
   - **Fix:** Drop `onto` and `from` from the type and from both object
     literals.
   - **If we skip it:** A reader assumes some caller depends on them and keeps
     them in sync for nothing.

2. **`handRestack` redoes reads `resumable` just made** (`claude/hooks/ship.ts`,
   `handRestack`)
   - **What this is:** `resumable` calls `handRestack` right after it ran
     `chain(git, ok, branch, recorded, done, "", at)` and `topGuard` (which read
     `TOP_KEY`), and it already has `last` and `branchOf`.
   - **Problem:** `handRestack` recomputes `last` and `branchOf`, reads
     `TOP_KEY` again, and calls `chain` again with the very same arguments (top
     is `""` whenever the guard says `rebased`). That is a second copy of the
     `branchOf` rule that must change together with the first, plus a repeat of
     every ancestry check.
   - **Fix:** Pass `branchOf` and the `commits` from the first `chain` call into
     `handRestack`; delete its own `last`/`branchOf`/`chain` lines. The
     `defaultBranch(git)` read can also come in as a parameter, since
     `preflight` already resolved it.
   - **If we skip it:** The slice-branch naming rule lives in three places
     instead of two.

3. **The old-git rebase failure path has no test** (`claude/hooks/ship.ts`,
   `restackOf` → `run`, the `if (!stopped)` branch)
   - **What this is:** When `git rebase --update-refs` fails without starting
     (git older than 2.38, which the docs now require), `REBASE_HEAD` is unset
     and the ship returns "git rebase failed; refs are unchanged" without
     running `git rebase --abort`.
   - **Problem:** Only the conflict case is tested (REBASE_HEAD set). Removing
     the `!stopped` branch leaves every test green, and the user on old git
     would then get "tree and refs are as before" plus a hand command that fails
     the same way.
   - **Fix:** One test: script the rebase to fail and
     `rev-parse --verify --quiet REBASE_HEAD` to exit 1; assert the "refs are
     unchanged" text and that no `git rebase --abort` ran.
   - **If we skip it:** The one path users on older git hit is unguarded.

Verdict: fix 3 first; 1 and 2 are cheap cleanups. Lean: -12 lines possible.

## test-audit: one test pins a bug, one is vacuous, two refusals are unguarded

The correctness and ponytail chunks above already cover the scripted-git drift,
the hand-restack lease test and the config write order. They are not repeated
here.

1. **A test pins a non-force push after a rebase** (`claude/hooks/ship.test.ts`,
   "pushBranch with a lease" → "no origin copy takes today's first push")
   - `pushBranch` checks `rev-parse --verify --quiet origin/<b>` before it looks
     at `lease`. A lease only exists when `ls-remote` saw the branch on origin.
     So when a lease is passed, origin has the branch by definition. If the
     local tracking ref is missing (pruned or deleted by hand; `cat-file -e`
     only proves the sha is local), the restacked branch goes out as a plain
     `git push --set-upstream`. Origin then rejects it as non-fast-forward,
     after the rebase and the record shrink.
   - The test passes a lease, scripts the tracking ref as absent, and asserts
     the non-force push with no `--force-with-lease`. That locks in the wrong
     branch order.
   - Fix: check `lease` before the tracking-ref probe, and change the test so a
     lease with no tracking ref expects `--force-with-lease=<b>:<lease>`.

2. **Two refusals in `restackOf` have no test**
   - The `git ls-remote origin failed; nothing changed.` refusal: script
     `ls-remote` with `code: 1` in `two`. Deleting the `read.code !== 0` check
     leaves every test green. The ship would then go on with an empty origin
     map: no lease, no "holds commits" refusal, and a weaker push.
   - A link that `ls-remote` does not list (branch never pushed): the `-n`
     preview's `--set-upstream` line and the no-lease push are never exercised.
     Every fixture lists every link.
   - Add one test for each, reusing `two`/`three`.

3. **Vacuous negative control** ("the lease is origin's ls-remote sha even when
   origin/<b> differs")
   - Its only new input is a different stdout for
     `rev-parse --verify --quiet origin/feat/x`. No code path reads that output,
     only its exit code. So `not.some(c => c.includes("7777…"))` cannot fail,
     whatever the lease logic does. The positive assertion repeats
     `--force-with-lease=feat/x:${O}` from the first restack test.
   - To guard what the name says, make the guard observable: give the fixture an
     `origin/feat/x` sha that differs from `O`, and assert on the lease-bearing
     push. Otherwise delete the test; the first test already owns the contract.

4. **Correction to ponytail item 3:** the old-git path is tested. "a rebase
   failing with none in progress (old git) reports stderr and aborts nothing"
   (added in 7c59d849) leaves `REBASE_HEAD` unscripted. The `repo()` fixture
   defaults to `out: ""`, so `stopped` is falsy. Removing the `!stopped` branch
   would run `git rebase --abort` and fail its `not.toContain` assertion. No new
   test is needed.

5. **Nit: the top-slice conflict name passes via the fallback**: "a conflict on
   the top slice names the top slice" sets `REBASE_HEAD` to `S3`. No link holds
   that commit except the top, which the lookup excludes. So the test passes
   through `links.at(-1)`. It would also pass if the `l.commit === stopped`
   match were broken for every slice. The middle-slice test is the one that owns
   the match, and it does.

## conventions: the restack ships with no scenario, no port twin, and one stale comment

I read `CLAUDE.md` (which pulls in `@AGENTS.md`), `AGENTS.md`, `CONTEXT.md`, the
user's global `CLAUDE.md`, and `COMPATIBILITY.md`/`docs/commits.md` (linked from
`AGENTS.md`). The README rule is met: the README mentions the re-ship restack.
The docs prose names no `src/*.ts` module. No new imports cross a boundary. The
claude mod is in no compatibility tier, so `!` is not in question. These things
break the rules:

1. **No `@inmem` scenario for a new feature.** Rule (AGENTS.md, Testing):
   "create cucumber.js scenarios for each new feature, tagged `@inmem`". The
   restack is a new user-facing behaviour of `/gtd ship`, with new text in the
   README and docs/driver.md. All of its coverage is vitest cases in
   `claude/hooks/ship.test.ts`. No `.feature` file covers ship at all, so this
   follows the mod's existing habit. It is still a gap against the written rule.
   Either add an `@inmem` scenario (a squash-merged lower slice, then a re-ship
   restacks and shrinks the stack), or say in the PR why `claude/` is exempt.

2. **The restack reaches git through a port with no in-memory twin and no
   contract test.** Rule (AGENTS.md, Testing): "reach every external resource
   (git, …) through a port with a live and an in-memory implementation, and hold
   the two together with a contract test that runs the same cases against both".
   `rebase --update-refs`, `ls-remote` parsing and the `REBASE_HEAD` probe go
   through `io.run`. They are tested only against scripted output in the
   `repo()` map. The correctness chunk "mock/live drift" already gives the fix;
   it is listed here because it breaks an explicit rule, not only because it is
   a risk.

3. **A comment says something the code does not do.** Rule (AGENTS.md,
   Comments): a comment is "where a non-obvious invariant lives… keep it to the
   decision and its reason". The doc comment on `handRestack` says "the
   remaining slice branches already sit on the default branch" and "Every
   condition must hold, or an unrelated rebase would turn into a force push". No
   condition checks that the branches sit on the default branch (see the
   correctness chunk on the hand-restack path). The README and docs/driver.md
   repeat the same claim: "the remaining slice branches now sit on the default
   branch… pushes each with a lease". A reader who trusts the comment is worse
   off than one who reads the code. Make the code match the comment, as the
   correctness fix does, or cut the comment down to what is actually checked.

4. **Nit: glossary words.** Rule (AGENTS.md): "`CONTEXT.md` … Read it before
   naming anything". CONTEXT.md lists "resume" as a word to avoid (under Replay)
   and "run" as a word to avoid for a process. The change adds the names
   `resumeAlone` and `finishResume`, and docs/driver.md says "in one run" and "a
   same-run squash". The ship code already used "resume" before this change, and
   here it means picking up a stack again, not replaying. So this is cosmetic.
   In the docs, "in the same `/gtd ship`" would avoid using "run" loosely next
   to the glossary's Process and Episode.
