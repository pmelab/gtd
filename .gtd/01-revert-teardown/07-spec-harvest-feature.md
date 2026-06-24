# Rewrite `spec-harvest.feature`: routing assertions, not harvested `!!` body text

The harvested-`!!`-text assertions are obsolete — gtd no longer injects per-`!!`
text into the prompt (it reduced to the boolean `bangPresent`). Rewrite the
scenarios that assert `!!` body text in stdout to assert ROUTING only, and assert
the prompt drives the agent to read the commit-"x" diff (artifact-free teardown).

This task owns `tests/integration/features/spec-harvest.feature` exclusively. The
asserted strings come from the rewritten prompt (task 05) and the boolean
`bangPresent` (tasks 01/03); all in the same commit, bundle rebuilt by `BeforeAll`.

## Files (exclusive to this task)

- `tests/integration/features/spec-harvest.feature`

## What to do

Update the top-of-file comment to describe the new model: `!!` on lines added
since the review-create commit divert an otherwise-approved review into
`review-process` (boolean `bangPresent`); the prompt instructs the agent to read
the commit-"x" diff and `git revert` it, leaving NO `!!` artifact. The per-comment
text is no longer surfaced.

Per scenario (use existing composable Given steps only):

1. **"A checked review plus a `!!` comment loops and harvests the comment"**
   (~13-47): keep the setup. Change assertions:
   - keep `And stdout contains "# Process Review Feedback"` (routes to
     review-process, NOT close)
   - keep `And stdout does not contain "## Task: Close the approved review"`
   - REMOVE `And stdout contains "handle the empty-input edge case"` (harvested
     text no longer surfaced)
   - ADD `And stdout contains "git revert --no-edit"` (teardown reverts the `!!`
     committed in "x" → artifact-free) and optionally
     `And stdout contains "git show"` if the rewritten prompt names it.
   Retitle to reflect "routes to review-process" rather than "harvests".

2. **"The `!!` marker is recognized regardless of comment syntax"** (~49-85):
   keep setup; replace `And stdout contains "validate the config before running"`
   with `And stdout contains "# Process Review Feedback"` (routing-only). Keep the
   existing `# Process Review Feedback` assertion.

3. **"Harvesting captures the `!!` text verbatim without parsing intent"**
   (~87-119): this scenario's whole point was verbatim text capture, which no
   longer happens. Either DELETE it or repurpose it to assert routing
   (`# Process Review Feedback`, `git revert --no-edit`) — prefer deletion to
   avoid duplicating scenario 1. Remove the
   `this is probably fine but double-check the rounding` assertion.

4. **"Unreferenced reviewer-added `!!` IS harvested"** (~121-160): retitle to
   "Unreferenced reviewer-added `!!` still diverts to review-process". Keep
   `# Process Review Feedback`; REMOVE the
   `xyzzy-sentinel-unreferenced-scope-check` text assertion. This still exercises
   the boolean `bangPresent` (an `!!` on a line added after the review-create
   commit, in a file REVIEW.md does not reference, must still divert).

5. **"A `!!` committed at/before the review commit is NOT harvested"**
   (~162-193): KEEP as-is — it exercises the surviving `bangPresent` boolean
   (pre-review `!!` is not new, so pure forward-tick → close-review). Assertions
   `## Task: Close the approved review` and
   `does not contain xyzzy-sentinel-pre-review-commit` remain valid.

6. **"A plain `TODO:` marker is ordinary code and does not block conclusion"**
   (~195-227): KEEP as-is — plain `TODO:` is not `!!`, so `bangPresent` is false
   and a pure forward-tick → close-review. Assertions unchanged.

## Constraints

- No assertion may depend on harvested `!!` body text appearing in stdout.
- Use existing composable Given steps only; each committing step ↔ one commit.
- Keep the two surviving-boolean scenarios (5, 6) intact.

## Acceptance criteria

- [ ] No scenario asserts `!!` comment body text in stdout (no
      "handle the empty-input edge case", "validate the config before running",
      "double-check the rounding", "xyzzy-sentinel-unreferenced-scope-check").
- [ ] The reviewer-added-`!!` scenarios assert routing to `review-process`
      (`# Process Review Feedback`) and the revert teardown
      (`git revert --no-edit`).
- [ ] The pre-review-`!!` → close-review and plain-`TODO:` → close-review
      scenarios are retained and pass.
- [ ] `npm run test:e2e` (cucumber) is green.
