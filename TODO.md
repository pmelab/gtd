# Issue #128 — review sign-off unreachable when `reviewFile` lives outside `.gtd/`

Full issue: `gh issue view 128`.

## Symptom

With `reviewFile` configured **outside `.gtd/`** (e.g.
`vars.reviewFile: "REVIEW.md"` at the repo root), review sign-off is
unreachable. Every clean sign-off attempt (tick all boxes, no comment, no code
edit) is misclassified as feedback, so the process loops forever:

```
reviewing → await-review → review-deciding → feedback-collecting
→ feedback-building → checking → reviewing → …
```

## Root cause

`review-deciding`'s script in `src/workflows/unified.yaml` detects human
hand-edits with a hardcoded path assumption:

```bash
codeFiles=$(git diff-tree --no-commit-id --name-only -r HEAD | grep -v '^\.gtd/')
```

The steering paths are var-configurable. With `reviewFile` at the repo root, the
human's checkbox-tick commit (touching only `REVIEW.md`) survives the filter,
`codeFiles` is non-empty, and the script takes the feedback branch instead of
the sign-off branch.

## Suggested fix

Exclude the state's own steering file explicitly instead of (or in addition to)
the `.gtd/` prefix:

```bash
codeFiles=$(git diff-tree --no-commit-id --name-only -r HEAD \
  | grep -v '^\.gtd/' | grep -vxF "$reviewFile")
```

It is the only `grep -v '^\.gtd/'` site in the template. Consider also excluding
_all_ var-named steering files (`todoFile`, `requirementsFile`, …), since any
can be repointed outside `.gtd/` and edited during a review round.

## Tests

Add an e2e scenario: workflow with a root-level `reviewFile`, human ticks every
box with no comment, assert the step routes to sign-off/squash rather than
`feedback-collecting`.

## Also update

- `README.md` if behavior/config docs are affected.
- STATES.md §10 if the unified template's review tail shape changes.
