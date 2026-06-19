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

**Dirty tree check:** If ref arg provided AND working tree is dirty → error exit with "Commit or stash changes before starting review". Review mode requires clean tree to start—prevents confusion about diff scope.

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

Detection logic in `detect()` with **early-return for exclusive branches**:
1. Check if `REVIEW.md` exists - if yes and modified → return `"review-process"` branch immediately (exclusive, ignore other signals)
2. If ref argument provided → return `"review-create"` branch immediately (exclusive)
3. Existing logic for other branches continues only if neither review branch applies

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

File paths use relative format: `./path/to/file.ts#42` (line number only, no ranges). Line numbers are creation-time hints only; agent ignores drift when processing review.

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
10. Error when ref arg provided with dirty working tree

**Create:** Unit tests for new Git methods in a vitest file

---

## Open Questions

### How should ref argument be passed to `detect()`?

Currently `detect()` takes no arguments—dependencies come via Effect. Options:

- **A) Add refArg to State interface** — `detect()` reads from State, but State is the output not input
- **B) Create RefArg service tag** — `class RefArg extends Context.Tag<...>` passed via layer
- **C) Add parameter to detect()** — `detect(refArg?: string)` directly
- **D) Check process.argv inside detect()** — simplest but couples to global

**Recommendation:** Option C. Direct parameter is simplest. `detect()` already uses Effect.gen, adding a parameter doesn't break anything. Other options add ceremony for a single optional string.

<!-- user answers here -->

### What happens when REVIEW.md exists but is NOT modified?

Plan says "REVIEW.md exists - if yes and modified → review-process". But what if:
- REVIEW.md committed, user runs `/gtd` without making any changes
- User wants to abandon review and start over

Options:
- **A) Unmodified REVIEW.md → error** — Force user to either modify or delete
- **B) Unmodified REVIEW.md → re-show review-create prompt** — Let agent regenerate
- **C) Unmodified REVIEW.md → special "review-pending" branch** — Prompt user to continue or abandon

**Recommendation:** Option A with helpful message: "REVIEW.md exists but has no changes. Edit REVIEW.md to provide feedback, or delete it to abandon review." Keeps state machine simple—two states (creating, processing) not three.

<!-- user answers here -->

### What diff should context show during review-process?

Two candidate diffs:
- **Uncommitted changes** — Shows user's feedback edits (current `diffHead` behavior)
- **Base..HEAD diff** — Shows original changes being reviewed (from stored base ref)

Agent needs BOTH to process review: the original changes (to understand what's being reviewed) AND the user's feedback edits (to extract comments).

**Recommendation:** Include both in context. Modify `buildContext()` to show:
1. "### Original changes (from `<base>` to HEAD)" — `git diff <base> HEAD~1` (before review commit)
2. "### User feedback edits" — current uncommitted diff

Or simpler: just show the working diff (user feedback), and instruct agent to read REVIEW.md for context about what was being reviewed.

<!-- user answers here -->

### What if `git diff <ref> HEAD` produces empty diff?

User runs `gtd HEAD` or `gtd <ref>` where ref equals HEAD. No changes to review.

Options:
- **A) Error immediately** — "No changes between <ref> and HEAD to review"
- **B) Create empty REVIEW.md** — Let agent handle it (will produce useless file)
- **C) Error in prompt** — Let detection succeed, error in review-create prompt

**Recommendation:** Option A. Fail fast in CLI before even entering review mode. Check `git diff --stat <ref> HEAD` output; if empty, error with clear message.

<!-- user answers here -->
