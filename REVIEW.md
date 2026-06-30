# Review: 1a09822

<!-- base: 1a09822e1d276ec6efa6462f03040ca347fa7695 -->

## Fix seedNewFeature with no baseline

Previously `diffRef("HEAD~1")` was wrapped in `catchAll(() => "")`, so when the
repo had no prior commit (HEAD~1 missing) the diff silently fell back to an
empty string and the new task content was lost from TODO.md. Now the base ref is
resolved first (`resolveRef("HEAD~1")`), falling back to `EMPTY_TREE` on
failure, then diffed against — so the full first-commit content is captured.

Worth confirming: `diffRef` runs `git diff <ref> HEAD`, and the EMPTY_TREE
fallback relies on HEAD still pointing at the just-made `gtd: new task` commit
at diff time (revert happens after). Check the resolve/diff ordering holds.

- [ ] ./src/Events.ts#390

## Test: no baseline commit

Adds a scenario seeding a fresh `git init` repo (no `chore: init` baseline) and
asserts the change lands in TODO.md and the working file is reverted. Inline
setup matches the AGENTS.md one-commit-per-step convention.

- [ ] ./src/Events.test.ts#554
