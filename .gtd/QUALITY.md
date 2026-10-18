# Quality findings

## correctness: an origin-deleted slice branch still hits the stale tracking ref on a restack push (claude/hooks/ship.ts `pushBranch`, `originLeases`)

The new `gone` flag fixes only the persisted-key path: when `ls-remote` shows
origin lost the branch, the key is unset and the branch is pushed fresh. The
restack's own path has the same problem and stays unfixed. `originLeases`
already ran `ls-remote` and found no sha for the slice, so `l.lease` is
`undefined`. Then `pushLink` → `pushBranch(io, b, commit, undefined)` runs with
no key, so `gone` stays false. It falls through to
`rev-parse --verify origin/<b>`, which a never-pruned tracking ref still passes,
and the rebased head is not an ancestor of it, so it pushes with a bare
`--force-with-lease`. That lease expects the stale tracking sha, so git rejects
it ("stale info"). The refusal tells the user to "Fetch and reconcile first",
but a plain fetch does not prune, so every retry fails the same way. (The
`is-ancestor HEAD origin/<b>` branch is worse: it returns success without
pushing, and the PR step then targets a branch origin lacks.)

Consider: carry "absent on origin" from `originLeases` into the link, for
example as a sentinel lease, so `pushBranch` takes the `--set-upstream` path. Or
make `pushBranch` trust `ls-remote` over the tracking ref whenever the tracking
ref is the only thing deciding between fresh push and lease. Add a restack test
where `ls-remote` omits a slice and `rev-parse --verify --quiet origin/<slice>`
succeeds.

## correctness: `keptByHand` comment describes a staleness test the code does not do (claude/hooks/ship.ts `keptByHand`)

Nit: the comment says the range starts at "the merge base, once that top is
stale". The code falls back only when the recorded top object is missing
(`cat-file -e top` fails). A top that still exists but is stale (the earlier
comment's sense: the top branch was re-shipped or restacked since) stays the
lower bound. Today that is harmless, because commits past a stale top are judged
by identity anyway. But the next reader will believe a staleness check exists.
Say "gone" (as the test name "a recorded top that is gone" does), not "stale".

## correctness: docs dropped the refusal for a slice merged into a non-slice branch (README.md, docs/driver.md)

Nit: both docs now say the restack refuses when a pull request "merged into a
slice branch whose chain never reached the default branch". The code
(`landedOn`/`unsettled`) also refuses when a slice merged into any branch that
is not a slice branch at all, which the old wording ("a branch other than the
default branch") covered. It also refuses when a slice merged into a lower
slice's branch after that branch had already landed, and when gh reports no
`mergedAt`. Reword to cover these cases, for example "merged anywhere but the
default branch, unless it merged into a lower slice branch before that one
merged into the default branch".

## owasp-security: a collaborator's amended commit on origin passes `keptByHand` and is force-pushed away (claude/hooks/ship.ts `keptByHand`)

[LOW] Data-integrity guard keyed on spoofable metadata, not content (CWE-345,
OWASP A08:2025 Software or Data Integrity Failures)

Path: origin/<slice> (written by anyone with push access) → `originLeases` →
`keptByHand` compares `%an %ae %at %B` only → lease = origin's sha → restack
`push --force-with-lease=<slice>:<that sha>` overwrites it.

`git commit --amend` (and `rebase -i` edit/fixup) keeps author name, email,
author date and, usually, the message. A collaborator who amends a slice commit
with a content fix and force-pushes produces a commit whose identity equals the
local, pre-amend one, so `theirs.every((i) => mine.has(i))` holds, the lease is
taken on their sha, and the restack's push discards their change with no
refusal. The old reflog/ancestor check refused this (their sha is neither in the
local reflog nor an ancestor of the top); the new one weakens that guard. Not
attacker-exploitable — whoever can push to origin can already delete the branch
— the harm is silent loss of a trusted collaborator's work, which is exactly
what the `holds commits <b> lacks` refusal exists to prevent.

Consider: match on identity AND content — require `git patch-id --stable` of
each origin commit to equal that of its identity twin in the local range (a hand
rebase that resolved a conflict would then refuse, which is the safe direction),
or at least compare tree diffs for twins with equal identity. Add a test:
origin's slice tip is an amended copy of a local commit (same identity,
different diff) and the restack must refuse before any write.

Hardening noted, not a finding: resolving slice branches as `refs/heads/<b>` (a
tag of the same name can no longer redirect rebase ranges or `rev-parse`), and
`landedOn` failing closed on a missing/unparseable `mergedAt` (NaN compares
false → refusal). All git/gh calls stay argv arrays, no shell; branch names
cannot start with `-`.

## ponytail-review: a top slice that merged into a lower slice which then landed gets a false "not main" refusal (claude/hooks/ship.ts `unsettled`)

Should fix. `landedOn` (merged into a lower slice before that slice merged into
the default branch counts as landed) is applied only inside the `done` loop,
which stops below the top slice. `unsettled` then judges every slice at or above
`done` with the old test `baseRefName !== c.baseBranch`, so it ignores the new
rule.

Case: stack `feat/x-refactor`, `feat/x` (top). The top PR merges into
`feat/x-refactor` first, then `feat/x-refactor` merges into `main`. GitHub does
not retarget an already-merged PR, so the top PR keeps base `feat/x-refactor`.
The user adds a commit and runs `/gtd ship`: `done` becomes 1, `unsettled` sees
the top MERGED with base `feat/x-refactor` and returns `mergedElsewhere`:
"merged into feat/x-refactor, not main ... Ship the branch alone with
GTD_SHIP_MODE=commits". That is false (its change is in `main`) and the advice
points at the wrong cure. The code before this change said "is MERGED, not open
... Rename the branch", which was right. It also contradicts the new
README/driver.md wording ("a slice branch whose chain never reached the default
branch").

Fix: in `unsettled`, test
`view.state === "MERGED" && !landedOn(c.states, i, c.branchOf, c.baseBranch)`
instead of the bare base check, so a landed top falls through to the "is MERGED,
not open ... Rename the branch" refusal. Slices above `done` merged into an open
lower slice still refuse as before (that slice has no `mergedAt`). Passing `c`
to `landedOn` instead of its four fields would also drop the duplicated
parameters. Add a test: two-slice stack, top MERGED into the lower branch with
`mergedAt` earlier than the lower's, lower MERGED into main; expect the "Rename
the branch" refusal and no write.

## test-audit: the "retry after a failed push" test retries nothing (claude/hooks/ship.test.ts "a retry after a failed push reads the same origin/main merge base")

Should fix. `repo()` is stateless: each call builds a fresh recorder over a
script that is never mutated, and the second run's script (`stale`) carries no
config key, record or lease the first run might have written. So the failed
first run is dead setup (its one assertion is `ok: false`). The second run is
the same scenario as the test above it, "a stack's first writer prompt
describes...", and makes weaker assertions. Retry-specific base drift (for
example a `gtdStack`/`gtdStackTop` record left by run one that makes run two
take the resume path) is never exercised. Either give the second run what the
first one persisted (script the config reads from the first run's
`git config --local <key> <value>` writes) or delete the test.

## test-audit: `keptByHand`'s range exclusions are pinned by argv only, never by behaviour (claude/hooks/ship.test.ts "the merged slice's commits are excluded from origin's range")

The test asserts the exact `git log ... <sha> ^<lower> ^origin/main ^<from>`
argv. In the `hand` fixture that log call is unscripted, so it returns empty and
`theirs` is `[]`. `keptByHand` therefore passes whether or not `^from` or
`^onto` is present: the contract in the test's name ("a merged slice's commits
on origin are not foreign") has no proof. The only thing that fails is an
argv-order change, and a behaviour-preserving rewrite (`lower..sha`, reordered
excludes) breaks it. Consider: give the merged slice's commit identity only to
the argv that lacks `^<from>`, and leave the full-exclusion argv empty. Then
dropping the exclusion produces the refusal, and the test asserts `ok: true`.
Note the harness falls back by stripping one trailing `^\w+`; that fallback
needs care here.

## test-audit: `keptByHand`'s "no common history" refusal is untested (claude/hooks/ship.ts `if (!lower) return false`)

No test makes `cat-file -e <top>` fail and `merge-base <sha> refs/heads/<b>`
come back empty (origin's branch unrelated to the local one). If the guard were
flipped to `return true` or deleted, the suite would still pass: with `lower`
empty, the unscripted log returns nothing and `every` holds. Add a case to the
"recorded top that is gone" describe: merge base unscripted/empty, expect the
"holds commits ... lacks" refusal and no write.

## test-audit: "both land and the restack proceeds" does not pin the outcome (claude/hooks/ship.test.ts "a slice merged into a lower slice branch")

The positive case asserts only that the text lacks "merged into" and that a
fetch ran. Any later refusal or failure with different wording still passes. So
does a wrong `done` count, for example treating only the lowest slice as landed,
which would rebase the already-merged middle slice. Assert the result (`ok`),
and assert what `done = 2` must produce: the rebase range starts above the
middle slice, and the record shrinks to the top slice alone.

## test-audit: `untouched` is named backwards and is weaker than the in-scope `writes` (claude/hooks/ship.test.ts "a slice merged into a lower slice branch")

Nit. `untouched(ran)` returns true when something WAS touched, and is used as
`expect(untouched(ran)).toBe(false)`. Its regex also matches only
fetch/push/rebase/config writes. It misses `gh pr create|edit`, `reset`,
`commit` and `branch`, which the enclosing describe's `writes` regex covers. So
these three "nothing changes" refusals prove less than their sibling refusal
tests. Use `writes` (plus `fetch`, if a fetch must also be ruled out).

## test-audit: implementation-shape assertions riding on behaviour tests (claude/hooks/ship.test.ts)

Nit.

- "origin holding a commit the local branch dropped by hand refuses ..." also
  asserts `no git reflog` call. The refusal itself already fails under the old
  reflog logic, because the scripted reflog lists O2. The extra line only pins
  the implementation and can go.
- `bareSlice` greps argv for bare slice names in
  rev-parse/rev-list/merge-base/log/cat-file only. It is a call-shape check, and
  the only proof the argv-scripted fake can give of the tag-shadowing fix. Keep
  it, but know it misses other subcommands (`for-each-ref`, `diff`, `rebase`
  operands) and any path the two fixtures do not reach. A real-git case (a tag
  named like a slice branch) would be the real owner.
- "single-PR path after the stack was forgotten, ..." sets up no stack and no
  forgotten record. Drop "after the stack was forgotten" from the name.

## conventions: the restack's new git semantics are proven only against an argv-scripted fake, with no live twin (claude/hooks/ship.test.ts, claude/hooks/ship.ts)

AGENTS.md, Testing: "reach every external resource (git, a shell, …) through a
port with a live and an in-memory implementation, and hold the two together with
a contract test that runs the same cases against both. A scenario needing a
resource the in-memory tier lacks is a missing twin, not a reason to go
`@live`".

`ShipIo` is the port, but its only in-memory side is a per-test map from exact
argv to scripted output, with no contract test against real git. This change
adds behaviour whose correctness is git's semantics, not gtd's logic: the
`refs/heads/<b>` qualification (the tag-shadowing fix), `resolveRef`'s ancestry
choice between `main` and `origin/main`, and `keptByHand`'s
`git log --format=…%x1e sha ^lower ^onto ^from` range. The fake answers whatever
argv the test scripts, so it cannot show that a tag named like a slice branch
would ever have won, or that the range excludes what the comment says. That is
why `bareSlice` has to grep argv shapes (see test-audit). The gap predates this
change, but this change adds to it. The new restack outcome (a slice merged into
a lower slice branch that landed first now restacks) also has no `@inmem`
scenario ("create cucumber.js scenarios for each new feature, tagged `@inmem`").

Consider: a small real-git contract case (temp repo, one tag named like a slice
branch, one diverged local `main`) run against the live `ShipIo`. Or record the
missing twin as a follow-up rather than adding more argv-only assertions on ref
semantics.

## conventions: `originLeases`' comment restates its parameter (claude/hooks/ship.ts `originLeases`)

Nit. AGENTS.md, Comments: "Everything else (restatement of the code, history, a
'what' with no 'why') gets deleted, not moved." The edited clause
"`kept(l, sha)` says origin's commit survives the restack" only renames the
parameter in prose. Drop it, and keep the lease and refuses-before-writes
reasons, which are the decision.
