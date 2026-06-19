add a review feature:

- user run "/gtd [commit hash or git ref]"
- agent take all diff hunks an slice them into semantically connected, easy to review chunks
- create file REVIEW.md with chunks, explanation for each chunk and list of hunks as checkboxes: `- [ ] ./path/to/file#linenumber` e.g. `- [ ] src/elements/button.tsx#4`
- commit review file
- user reads file and checks off all hunks
- user leaves comments in source code
- user leaves comments in REVIEW.md
- when user run "/gtd" and review file exists:
  - collect all changes in code an REVIEW.md and compose TODO.md from them
  - reset those changes
  - delete REVIEW.md
  - commit TODO.md and deletion of REVIEW.md
  - start new process of work on new TODO.md with grilling

---

## Implementation Plan

### Phase 1: CLI Argument Parsing

**Location:** `src/main.ts`

Add argument detection for optional git ref:

```typescript
const refArg = process.argv[2] // undefined if not provided
const isReviewMode = refArg !== undefined
```

Validate ref by calling `git rev-parse <ref>` before proceeding:
- Success -> review mode with resolved commit hash
- Failure -> error exit with "invalid git ref"

**Conflict detection:** If REVIEW.md exists AND ref arg provided → error exit with "REVIEW.md already exists. Complete or delete existing review before starting new one." No `--force` flag—keep it simple.

### Phase 2: State Detection Changes

**Location:** `src/State.ts`

Add new branches to `Branch` type:

```typescript
export type Branch =
  | ... existing ...
  | "review-create"     // git ref provided, generate REVIEW.md
  | "review-process"    // REVIEW.md exists with changes, convert to TODO
```

Detection logic in `detect()`:
1. Check if `REVIEW.md` exists - if yes and modified → `"review-process"` branch
2. If ref argument provided → `"review-create"` branch
3. Existing logic for other branches

**Modification detection:** Any change to REVIEW.md counts as valid review state—even checkbox-only edits with no text feedback. Signals approval without explicit comment.

### Phase 3: Git Service Extensions

**Location:** `src/Git.ts`

Add to `GitOperations` interface:

```typescript
readonly diffRef: (ref: string) => Effect.Effect<string, Error>
readonly resolveRef: (ref: string) => Effect.Effect<string, Error>
readonly checkoutTracked: () => Effect.Effect<void, Error>
readonly cleanUntracked: () => Effect.Effect<void, Error>
```

Implementation:
- `diffRef`: `git diff <ref> HEAD` — shows all changes from ref to current HEAD
- `resolveRef`: `git rev-parse <ref>` to validate and get full hash
- `checkoutTracked`: `git checkout -- .` for hard reset of tracked files
- `cleanUntracked`: `git clean -fd` to remove untracked files/dirs added during review

### Phase 4: New Prompt Files

**Create:** `src/prompts/review-create.md`

Instructions for agent to:
1. Parse diff from context (provided via `buildContext`)
2. Group hunks by semantic relationship (same feature, same refactor, etc.)
3. Generate REVIEW.md with format:

```markdown
# Review: <short-hash>
<!-- base: <full-hash> -->

## <Chunk Title>

<Explanation of what this chunk does>

- [ ] ./path/to/file.ts#42
- [ ] ./path/to/new-file.ts#1
- [ ] ./path/to/deleted.ts#1
```

File paths use relative format: `./path/to/file.ts#42` (line number only, no ranges)

4. Commit REVIEW.md with prefix `review(gtd):`

**Create:** `src/prompts/review-process.md`

Instructions for agent to:
1. Read changes in REVIEW.md (comments added by user)
2. Read ALL changes in source files as feedback — no marker convention, treat every modification as intentional review feedback
3. Re-diff from stored base ref: `git diff <stored-base> HEAD` to capture current state including any fixup commits made during review
4. Extract user feedback from both sources
5. Compose TODO.md from collected feedback
6. Stage TODO.md first, then execute reset:
   - `git checkout -- .` to reset tracked files
   - `git clean -fd` to remove untracked files added during review
7. Delete REVIEW.md
8. Commit TODO.md with REVIEW.md deletion
9. Normal flow continues (existing `new-todo` branch takes over)

**Error handling:**
- If `<!-- base: -->` comment missing from REVIEW.md → error "REVIEW.md is corrupted: missing base ref. Delete REVIEW.md and re-run with git ref to restart review."

### Phase 5: Prompt Building

**Location:** `src/Prompt.ts`

Add imports and SECTIONS entries:

```typescript
import reviewCreate from "./prompts/review-create.md"
import reviewProcess from "./prompts/review-process.md"

const SECTIONS: Record<Branch, string> = {
  ...existing,
  "review-create": reviewCreate,
  "review-process": reviewProcess,
}
```

Modify `buildContext()` to include ref-based diff when in review mode:
- Add `refDiff?: string` to State interface
- If ref provided, include `git diff <ref> HEAD` instead of working tree diff

### Phase 6: REVIEW.md File Format

Standard format:

```markdown
# Review: abc123
<!-- base: abc1234567890abcdef1234567890abcdef12345678 -->

## Authentication refactor

Extracts auth logic into dedicated service class.

- [ ] ./src/auth/AuthService.ts#15
- [ ] ./src/auth/AuthService.ts#42
- [ ] ./src/auth/types.ts#1
- [ ] ./src/index.ts#8

## Test updates

Updates tests for new auth service API.

- [ ] ./tests/auth.test.ts#23
- [ ] ./tests/auth.test.ts#89
```

The `<!-- base: -->` comment stores full hash for later reference when processing.

Checkboxes are UX affordance for user to track progress—all modifications processed regardless of checkbox state.

### Phase 7: Tests

**Create:** `tests/integration/features/review.feature`

Scenarios:
1. `gtd <valid-ref>` creates REVIEW.md and commits it
2. `gtd <invalid-ref>` errors gracefully
3. Modified REVIEW.md triggers review-process branch
4. Review process creates TODO.md, deletes REVIEW.md, resets source changes
5. Review process commits TODO.md and REVIEW.md deletion together
6. Error when REVIEW.md exists and ref arg provided simultaneously
7. Checkbox-only REVIEW.md (no text feedback) is processed as valid
8. Error when `<!-- base: -->` comment is missing from REVIEW.md
9. New untracked files created during review are cleaned up

**Create:** Unit tests for new Git methods in a vitest file

---

## Open Questions

### How should agent navigate to files when line numbers have drifted?

Line numbers in REVIEW.md (`./path/to/file.ts#42`) reference positions at review creation time. If user makes changes during review, lines shift. Agent needs to find correct location when processing feedback.

**Recommendation:** Use fuzzy matching. Store ~3 lines of context around each hunk reference in REVIEW.md (as collapsed details or HTML comment). When processing, agent searches for that context snippet rather than trusting line numbers. Line numbers become hints, not absolute references.

<!-- user answers here -->

### What happens if user has uncommitted changes when running `gtd <ref>`?

Current plan doesn't address dirty working tree + review creation. Options:
- A) Error: "Commit or stash changes before starting review"
- B) Stash automatically, create review, user unstashes after
- C) Allow it—review captures ref..HEAD diff, uncommitted changes separate concern

**Recommendation:** Option A. Clean separation. Uncommitted changes during review creation would confuse the diff scope. User can stash/commit first. Simple rule: review mode requires clean tree to start.

<!-- user answers here -->

### Should `review-create` and `review-process` be exclusive branches or composable?

Current `Branch` system allows composition (e.g., `todo-markers` + `code-changes`). Review branches seem inherently exclusive—you're either creating a review OR processing one OR doing normal work.

**Recommendation:** Exclusive. When REVIEW.md exists → only `review-process` branch, ignore other signals. When ref arg provided → only `review-create` branch. This prevents confusing mixed prompts. Add early-return in `detect()` for review states.

<!-- user answers here -->
