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

### Phase 3: Git Service Extensions

**Location:** `src/Git.ts`

Add to `GitOperations` interface:

```typescript
readonly diffRef: (ref: string) => Effect.Effect<string, Error>
readonly resolveRef: (ref: string) => Effect.Effect<string, Error>
readonly checkoutAll: () => Effect.Effect<void, Error>
```

Implementation:
- `diffRef`: `git diff <ref> HEAD` — shows all changes from ref to current HEAD
- `resolveRef`: `git rev-parse <ref>` to validate and get full hash
- `checkoutAll`: `git checkout -- .` for hard reset of working tree after review processing

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

4. Commit REVIEW.md

**Create:** `src/prompts/review-process.md`

Instructions for agent to:
1. Read changes in REVIEW.md (comments added by user)
2. Read ALL changes in source files as feedback — no marker convention, treat every modification as intentional review feedback
3. Extract user feedback from both sources
4. Compose TODO.md from collected feedback
5. Execute `git checkout -- .` to hard reset source changes
6. Delete REVIEW.md
7. Stage and commit TODO.md with deletion of REVIEW.md
8. Normal flow continues (existing `new-todo` branch takes over)

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

### Phase 7: Tests

**Create:** `tests/integration/features/review.feature`

Scenarios:
1. `gtd <valid-ref>` creates REVIEW.md and commits it
2. `gtd <invalid-ref>` errors gracefully
3. Modified REVIEW.md triggers review-process branch
4. Review process creates TODO.md, deletes REVIEW.md, resets source changes
5. Review process commits TODO.md and REVIEW.md deletion together

**Create:** Unit tests for new Git methods in a vitest file

---

## Open Questions

### What if REVIEW.md exists AND user passes a git ref?

Two conflicting signals: existing review file vs new review request. Which takes precedence?

**Recommendation:** Error exit with message like "REVIEW.md already exists. Complete or delete existing review before starting new one." This prevents accidental data loss (losing review comments) and forces explicit intent. Alternative: allow `--force` flag to override, but that adds complexity for edge case.

<!-- user answers here -->

### How to detect if REVIEW.md has actual feedback vs just being opened?

User might open REVIEW.md, check boxes, but add no text feedback. Should we require text feedback or process checkbox-only reviews?

**Recommendation:** Process any modification to REVIEW.md as valid review state. Even checking boxes without comments signals "these chunks are approved/reviewed." The agent can note "no explicit feedback provided" when composing TODO.md. Requiring text feedback adds friction for "LGTM" reviews.

<!-- user answers here -->

### Should hunks be extracted from the `<!-- base: -->` ref or current diff?

When processing REVIEW.md, the base ref might be stale (commits happened since). Should we:
A) Re-diff from stored base ref to HEAD (captures new changes)
B) Only look at changes user made to files (ignores new commits)

**Recommendation:** Option A — `git diff <stored-base> HEAD`. This ensures review covers all changes including any fixups made after REVIEW.md was created. The REVIEW.md checkboxes might reference stale line numbers, but the TODO.md gets composed from current state. Alternative: error if HEAD has moved past stored base.

<!-- user answers here -->

### What if user deletes the `<!-- base: -->` comment from REVIEW.md?

Without base ref, we can't reliably determine what was being reviewed.

**Recommendation:** Require the base comment. If missing, error with "REVIEW.md is corrupted: missing base ref. Delete REVIEW.md and re-run with git ref to restart review." Don't try to guess — user might have copy-pasted partial content. Simple failure mode > magic recovery.

<!-- user answers here -->
