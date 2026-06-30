# Push local commits to origin/main

## Description

The CI fix changes (Prettier format, Node 22, husky pre-commit hook, README
docs) are complete and committed locally. The only remaining task is to push all
local commits to `origin/main` so CI can verify them.

## Steps

- `git push origin main`
- Verify CI kicks off on the pushed commits.

## Acceptance Criteria

- [ ] `git push origin main` succeeds
- [ ] Remote branch `origin/main` is up to date with local `main`
- [ ] CI pipeline starts on the pushed commits

## Constraints

- Leave all working-tree changes uncommitted.
