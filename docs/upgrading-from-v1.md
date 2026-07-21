# Upgrading from v1 (BREAKING CHANGE)

## The label grammar (newest breaking change)

Machine commits now use **state labels**: every machine-authored subject names
the state it enters (`gtd: building`, `gtd: await-review`, `gtd: close-package`,
plus the two check-outcome markers `gtd: tests-green` / `gtd: test-failed`), so
`git log --oneline` reads as a state trace. The old routing subjects
(`gtd: planning`, `gtd: tests green`, `gtd: errors`, `gtd: package done`,
`gtd: awaiting review`, `gtd: review feedback`, `gtd: squash template`,
`gtd: reviewing <hash>`, `gtd: health-fix`,
`gtd: learning template/drafted/approved/applied`) fall outside the closed label
set and parse as inert **boundary commits** — exactly the mechanism that already
keeps v1 history inert. A repo at a settled boundary (idle, post-squash)
upgrades cleanly with no action. **Finish or squash any in-flight cycle first**:
a mid-cycle HEAD carrying an old routing subject is a boundary commit to the new
binary, so the cycle cannot be resumed.

One narrowing of the old v1 guarantee: v1's bare `gtd: grilling` and
`gtd: building` subjects now collide with live labels and parse as workflow
commits. This only matters for a repo whose HEAD (or nearest workflow commit) is
still a raw v1 subject — upgrade those from a settled boundary, same as above.

v2 ships as a **major** semantic-release bump (`2.0.0`) so the binary and the
loop-driving text ([docs/loop.md](loop.md), `skills/loop/SKILL.md`) can never
skew against each other. There is **no backward compatibility with the v1
command surface**: the single mutating `gtd` command, marker/sentinel files, the
`autoAdvance` JSON field, and the `gtd: transport` handoff commit are all gone.
`gtd` bare now errors rather than driving a loop; use `gtd step agent` /
`gtd next` / `gtd step human` instead.

**Commit-history compatibility is one-way.** Any repo with v1-taxonomy history
in it (`gtd: new task`, `gtd: grilling`, `gtd: transport`, a bare `gtd: review`
with no hash, …) upgrades cleanly: those subjects fall outside v2's closed
turn/routing grammar and parse as inert **boundary commits** — they are never
mistaken for v2 workflow state and never error.

**Finish or clean up any in-flight v1 cycle first.** If a repo has an
**in-progress** v1 cycle — steering files present (root-level `TODO.md`,
`REVIEW.md`, `FEEDBACK.md`, `ERRORS.md`, or `.gtd/`) whose HEAD carries v1-only
commit subjects — the v2 binary does not know how to resume it: v1 steering
files have no v2 turn commit backing them, so a cold v2 invocation on that tree
can land in an unrecognized state. Either finish the v1 cycle to a clean
boundary with your existing v1 binary before upgrading, or manually clean up
(remove the steering files / `.gtd/`, commit the result) so the upgrade starts
from a plain boundary HEAD.

**Steering files moved into `.gtd/`.** Earlier v2 builds kept `TODO.md`,
`REVIEW.md`, `FEEDBACK.md`, `ERRORS.md`, `HEALTH.md`, and `SQUASH_MSG.md` at the
repository root; they now live under `.gtd/`. Upgrade at a clean boundary (idle,
post-squash): a repo at rest needs nothing. Mid-cycle repos should either finish
the cycle on the old build first or move the root-level steering files into
`.gtd/` by hand and commit. History classification is backward-compatible — the
counter folds recognize both the old root paths and the new `.gtd/` paths in
existing commits.

**Re-copy the loop skill.** If you vendor `skills/loop/` into a consuming repo
or agent harness, upgrading the `gtd` binary also means re-copying that skill
from this release — the v1 skill text still describes the old single-command
loop and will drive the new binary incorrectly.

For maintainers: this repo releases via `semantic-release` reading Conventional
Commits, and needs **no config change** for a major bump — but the release
commit/PR **must carry a `BREAKING CHANGE:` footer** (or a `!` after the type)
for `@semantic-release/commit-analyzer` to compute `2.0.0` rather than a
minor/patch bump.
