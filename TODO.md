# Implementation Plan

## Goal
Restructure TODO.md format: open questions at top, answered questions retained in `## Answered Questions` at bottom.

## Tasks

1. **Update `new-todo.md` prompt**
   - File: `src/prompts/new-todo.md`
   - Changes: 
     - Instruct subagent to place `## Open Questions` at TOP of file (before plan body)
     - Add instruction to create `## Answered Questions` section at bottom (empty initially)
   - Acceptance: Prompt text describes new structure

2. **Update `modified-todo.md` prompt**
   - File: `src/prompts/modified-todo.md`
   - Changes:
     - Step 1: Move answered questions to `## Answered Questions` at bottom (instead of removing)
     - Keep question text but remove the `<!-- user answers here -->` marker
     - Append user's answer below recommendation
     - New questions still go in `## Open Questions` at top
   - Acceptance: Prompt instructs retention not deletion

3. **Update README documentation**
   - File: `README.md`
   - Changes:
     - Update "Q&A format inside TODO.md" section to show new structure
     - Update workflow description mentioning question handling
   - Acceptance: Docs match new behavior

4. **Update integration test scenarios**
   - File: `tests/integration/features/branches.feature`
   - Changes:
     - "Modified TODO.md triggers refinement" scenario: update example TODO.md to have questions at top
   - Acceptance: Tests reflect new structure

5. **Rebuild bundled script**
   - Command: `npm run build`
   - Changes: Regenerates `scripts/gtd.js` with updated prompt content
   - Acceptance: `scripts/gtd.js` contains new prompt text

## Files to Modify
- `src/prompts/new-todo.md` - question placement instructions
- `src/prompts/modified-todo.md` - retention vs removal logic
- `README.md` - documentation updates
- `tests/integration/features/branches.feature` - test fixture structure

## New Files
- None

## Dependencies
- Tasks 1-4 are independent, can execute in parallel
- Task 5 (rebuild) must run after tasks 1-2 complete

## Risks

1. **State detection unchanged** - `src/State.ts` uses `UNANSWERED_MARKER = "<!-- user answers here -->"` to detect finalized plans. This works regardless of section order → no change needed.

2. **Format ambiguity** - When moving answered question to bottom, should keep:
   - The `### Question` heading
   - The `**Recommendation:**` block  
   - The user's answer (without the HTML comment)
   
   Example answered question format:
   ```markdown
   ### What operations?
   
   **Recommendation:** add, subtract.
   
   **Answer:** add, subtract, multiply, divide
   ```

3. **Existing TODO.md files** - Users with in-progress TODO.md files using old format will need manual migration. The prompts should handle both formats gracefully during transition. Consider adding a note in modified-todo.md to recognize and migrate old-format files.
