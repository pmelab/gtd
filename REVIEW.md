# Review: 1a09822

<!-- base: 1a09822e1d276ec6efa6462f03040ca347fa7695 -->

## Guard transport mixed-reset against root commit

`mixedResetHead()` previously ran `git reset HEAD~1` unconditionally, which
crashes when the transport HEAD is the repository's root commit (no `HEAD~1`
parent) — issue #9. It now probes for a parent with
`git rev-parse --verify --quiet HEAD~1` via `Command.exitCode`, failing with a
clear "root commit" error when none exists, and checks the reset's own exit
code, failing on non-zero.

- [ ] ./src/Git.ts#151

## Cover the root-commit transport failure

New scenario asserting that a `gtd: transport` HEAD that is also the repo root
commit fails immediately with a clear error, backed by a new composable `Given`
step that spins up a fresh empty repo (via `mkdtemp` + `git init`) and commits
the WIP file as the root.

- [ ] ./tests/integration/features/transport.feature#24
- [ ] ./tests/integration/support/steps/common.steps.ts#74

## Docs and version bump

README note that a root-commit transport fails immediately with a clear error;
incidental package-lock version bump 1.0.0 → 1.1.0.

- [ ] ./README.md#215
- [ ] ./package-lock.json#3
