# Review: 1a09822

<!-- base: 1a09822e1d276ec6efa6462f03040ca347fa7695 -->

## Rework review-base into four rules

Replaces the old two-candidate review base (merge-base vs. last REVIEW.md
deletion) with a four-rule scheme evaluated in priority order: (1) within a
process, first review → first `gtd: grilling` of the cycle; (2) within a
process, incremental → last `gtd: awaiting review` (precedence over rule 1); (3)
outside a process on a feature branch → merge-base; (4) outside on the default
branch → skip review (Idle). Requires commit hashes, so `commitHistory` now
carries a `hash` field per entry. Diff is still gated to non-empty. This is the
centerpiece change; verify the cycle-boundary scan (last `gtd: done`) and the
rule-2-over-rule-1 precedence.

- [ ] ./src/Events.ts#372
- [ ] ./src/Events.ts#392
- [ ] ./src/Git.ts#39
- [ ] ./src/Git.ts#217
- [ ] ./src/Events.test.ts#357
- [ ] ./tests/integration/features/review.feature#12
- [ ] ./tests/integration/features/review.feature#229
- [ ] ./README.md#253

## Never write empty FEEDBACK/ERRORS

When a red test run produces empty or whitespace-only output, a sentinel string
is written instead so the file is never empty. Empty FEEDBACK stays reserved
exclusively for Agentic Review's approval signal, preventing a no-output failure
from being misread as an approval that would route to Close package instead of
Fixing.

- [ ] ./src/Events.ts#34
- [ ] ./src/Events.ts#561
- [ ] ./src/Events.test.ts#456
- [ ] ./tests/integration/features/testing.feature#66

## Typed test-runner spawn failure

`TestRunner.run` now fails the Effect with a typed `Error` on spawn failure
(missing binary / ENOENT), distinguishing it from a non-zero test exit (which
remains data driving the normal red path). ENOENT is detected via message
substring or the error `code`, surfacing `test command not found: <cmd>` on
stderr with exit 1. The test harness signature is updated to the fallible
Effect.

- [ ] ./src/TestRunner.ts#17
- [ ] ./src/TestRunner.ts#71
- [ ] ./src/TestRunner.test.ts#10
- [ ] ./tests/integration/features/testing.feature#226

## Config validation and error messages

Tightens the schema (`fixAttemptCap` non-negative int, `reviewThreshold` int
≥ 1) and hardens loading: YAML/JSON loaders wrap parse errors with the offending
filename and reject `null`; a non-object top-level level is rejected by
filename; `loadMerged` becomes a fallible Effect. Schema violations are
formatted concisely via `ArrayFormatter`
(`Invalid gtd config: <field>: <reason>`) rather than dumping the type tree.

- [ ] ./src/Config.ts#71
- [ ] ./src/Config.ts#130
- [ ] ./src/Config.ts#169
- [ ] ./src/Config.ts#229
- [ ] ./tests/integration/features/config.feature#203
- [ ] ./README.md#394

## Harden format subcommand & error exits

`formatFile` now fails (exit 1) instead of warning-and-succeeding: rejects
non-markdown extensions, rejects a missing file, and drops the swallow-all
`catchAll`. `main.ts` validates the `format` argv — missing path and too-many-
arguments both fail with a typed error. All these paths write to stderr and
exit 1.

- [ ] ./src/Format.ts#12
- [ ] ./src/Format.ts#22
- [ ] ./src/main.ts#41
- [ ] ./src/Format.test.ts#56
- [ ] ./tests/integration/features/formatting.feature#39
- [ ] ./README.md#579

## Guard transport reset at root commit

`mixedResetHead` now verifies `HEAD~1` exists before `git reset`; if the
`gtd: transport` commit is the repository root (no parent), it fails with a
clear error instead of looping. Both git invocations check their exit code.

- [ ] ./src/Git.ts#155
- [ ] ./tests/integration/features/transport.feature#24
- [ ] ./README.md#219

## Unquote C-quoted git paths

Adds `unquoteGitPath` to decode git's C-quoted porcelain path field (paths with
spaces/non-ASCII under `core.quotepath`), accumulating octal byte escapes into a
buffer for correct multi-byte UTF-8 reconstruction. Wired into
`parsePorcelainPaths` so a `.gtd` package file whose name contains a space is
classified correctly.

- [ ] ./src/Events.ts#65
- [ ] ./src/Events.ts#134
- [ ] ./tests/integration/features/grilling.feature#131

## Strip unclosed code fences in marker scan

`stripCode` now also strips a code fence that runs to end-of-input (no closing
fence), so an open-question marker inside an unterminated fence is not treated
as a live marker and does not wrongly STOP for the user.

- [ ] ./src/Events.ts#145
- [ ] ./tests/integration/features/grilling.feature#64

## Fix cap check & idempotent grilling STOP

Two machine fixes: `capReached` now applies `>= fixAttemptCap` to the
resume-reset count so `fixAttemptCap: 0` escalates immediately even on a
human-resume (previously hardcoded `false` on resume, granting one unintended
attempt). And re-running at a grilling STOP with a clean tree already at
`gtd: grilling` skips the redundant commit, making the gate idempotent.

- [ ] ./src/Machine.ts#406
- [ ] ./src/Machine.ts#503
- [ ] ./tests/integration/features/fixing.feature#47
- [ ] ./tests/integration/features/grilling.feature#96

## seedNewFeature root-commit baseline

The New Feature seed no longer diffs against a hardcoded `HEAD~1`; it resolves
`HEAD~1` and falls back to the empty tree when HEAD is the root commit, so the
verbatim input is still captured into TODO.md when there is no baseline commit.

- [ ] ./src/Events.ts#515
- [ ] ./src/Events.test.ts#430

## Test harness: root-commit & commit-count steps

New reusable Cucumber steps and world helpers: a "root commit … that adds …"
Given that inits a fresh empty repo, a `stderr does not contain` assertion,
commit-count record/assert steps, and a `commitCount()` world helper with a
`savedCommitCount` field.

- [ ] ./tests/integration/support/steps/common.steps.ts#74
- [ ] ./tests/integration/support/steps/common.steps.ts#135
- [ ] ./tests/integration/support/steps/common.steps.ts#190
- [ ] ./tests/integration/support/world.ts#74

## Version bump

Bumps package version to 1.1.4 and syncs the lockfile.

- [ ] ./package.json#3
- [ ] ./package-lock.json#4
