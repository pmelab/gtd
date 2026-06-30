# Cucumber scenarios for checkbox approval

Add scenarios to `tests/integration/features/review.feature` per AGENTS.md
(composable, generic Given steps; expose actual file content in scenario text).

## File

- `tests/integration/features/review.feature`

## Context

Reuse existing composable Given steps, e.g.
`a commit … that adds REVIEW.md with:` and `"REVIEW.md" is modified to:`. Do NOT
introduce one-off setup steps; if a needed generic step is missing, add a small
composable one and expose the real content in the scenario text. Each Given maps
to one commit.

## Scenarios

1. **Checking off REVIEW.md checkboxes approves the review** (new, positive):
   - commit REVIEW.md containing `- [ ]` boxes with `gtd: awaiting review`
   - `"REVIEW.md" is modified to:` the same content with `- [x]`
   - run gtd → last commit `gtd: done`; REVIEW.md does not exist; TODO.md does
     not exist; stdout does NOT contain "Grilling".

2. **Editing code under a committed REVIEW.md seeds a fresh plan** (existing
   negative case — keep, verify still passes): code edit → Accept Review.

3. (Optional) **Textual REVIEW.md annotation requests changes**: committed
   REVIEW.md, then modified with a non-checkbox textual annotation → Accept
   Review → `gtd: grilling`, proving non-checkbox REVIEW.md edits remain
   change-requests.

## Acceptance criteria

- [ ] New scenario "Checking off REVIEW.md checkboxes approves the review"
      asserts `gtd: done`, REVIEW.md absent, TODO.md absent, no "Grilling"
- [ ] Existing code-edit → Accept Review scenario still passes
- [ ] Scenarios use composable Given steps and show actual checkbox content
      inline (no abstract/hidden setup)
- [ ] Full cucumber + unit suite is green
