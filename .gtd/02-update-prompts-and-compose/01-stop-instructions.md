# Add STOP instructions to terminal prompts

Update `verify.md` and `review-create.md` to include explicit STOP instructions so the agent does not re-run gtd after these steps.

## What to build

1. **`src/prompts/verify.md`**: In the "Happy path" section, after "If all pass → done, report success", add explicit STOP instruction: the agent must not re-run gtd, the working tree is healthy and there is no pending work.

2. **`src/prompts/review-create.md`**: After the final step (writing REVIEW.md), add explicit STOP instruction: the agent must stop and let the user review/edit REVIEW.md before proceeding.

## Acceptance criteria

- [ ] `src/prompts/verify.md` contains text like "STOP" or "Do not re-run" in the success path
- [ ] `src/prompts/review-create.md` contains explicit STOP instruction after writing REVIEW.md
- [ ] The STOP instructions are clear and unambiguous
- [ ] Existing functionality of both prompts is preserved (no text removed, only added)

## Relevant files

- `src/prompts/verify.md` — add STOP after success path
- `src/prompts/review-create.md` — add STOP after final step

## Constraints

- Only ADD text, don't restructure existing content
- Keep STOP instructions brief (1-2 lines)
- Use consistent phrasing between both files
