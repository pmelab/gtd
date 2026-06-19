# Task: Create review-process Prompt File

## Description

Create prompt file for `review-process` branch that instructs the agent to extract feedback from REVIEW.md and source file changes, then reset the working tree.

## File Paths

- `src/prompts/review-process.md` (create new file)

## Implementation

The prompt should instruct the agent to:

### 1. Read Context

- Read `REVIEW.md` file for context (chunk titles, explanations, base ref)
- Read working diff (user's edits to REVIEW.md and source files)
- Note: agent does NOT need to re-examine original diff; REVIEW.md explanations provide context

### 2. Extract Feedback

- Treat ALL source file modifications as intentional review feedback
- No marker convention needed — every modification is feedback
- Extract feedback from REVIEW.md comments (text user added)
- Checkbox state is informational only

### 3. Compose TODO.md

- Create TODO.md from collected feedback
- Organize feedback into actionable items
- Reference original chunk context where helpful

### 4. Execute Reset Sequence

Order matters:

1. Stage `TODO.md` first (so it survives reset)
2. Execute `git checkout -- .` to reset tracked files
3. Execute `git clean -fd` to remove untracked files added during review
4. Delete `REVIEW.md`

### 5. Commit

- Commit with message: `docs(review): process review feedback into TODO.md`
- Commit includes TODO.md addition and REVIEW.md deletion

## Acceptance Criteria

- [ ] File created at `src/prompts/review-process.md`
- [ ] Instructions describe reading REVIEW.md for context
- [ ] Instructions describe treating all source changes as feedback
- [ ] Instructions describe reset sequence (checkout then clean)
- [ ] Instructions specify commit message: `docs(review): process review feedback into TODO.md`
- [ ] Instructions note no re-examination of original diff needed
- [ ] Instructions specify staging TODO.md before reset
