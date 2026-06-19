# Task: Create review-create Prompt File

## Description

Create prompt file for `review-create` branch that instructs the agent to generate REVIEW.md from a git diff.

## File Paths

- `src/prompts/review-create.md` (create new file)

## Implementation

The prompt should instruct the agent to:

### 1. Parse Input

- Read `refDiff` from context (the `git diff <ref> HEAD` output provided by buildContext)
- Identify all diff hunks with their file paths and line numbers

### 2. Semantic Grouping

- Group diff hunks by semantic relationship:
  - Same feature/functionality
  - Same refactor pattern
  - Same concern (e.g., all test updates, all import changes)
- Create logical chunks that make sense to review together

### 3. Generate REVIEW.md

Format:

```markdown
# Review: <short-hash>
<!-- base: <full-hash> -->

## <Chunk Title>

<Explanation of what this chunk does and why>

- [ ] ./path/to/file.ts#42
- [ ] ./path/to/file.ts#99
- [ ] ./path/to/other.ts#15

## <Another Chunk Title>

<Explanation>

- [ ] ./path/to/another.ts#1
```

### 4. File Path Format

- Relative paths: `./path/to/file.ts#42`
- Line number is creation-time hint only (agent ignores drift when processing)
- Each hunk listed separately (one checkbox per hunk location)

### 5. Commit

- Commit REVIEW.md with message: `review(gtd): create review for <short-hash>`
- Short hash is first 7 characters of base ref

## Acceptance Criteria

- [ ] File created at `src/prompts/review-create.md`
- [ ] Instructions describe the REVIEW.md format with `<!-- base: -->` comment
- [ ] Instructions explain semantic grouping of hunks into logical chunks
- [ ] Instructions specify commit prefix `review(gtd):`
- [ ] Instructions note line numbers are hints only
- [ ] Instructions specify short-hash is first 7 chars
