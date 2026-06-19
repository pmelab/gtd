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
```

Implementation:
- `diffRef`: `git diff <ref>^..<ref>` for single commit, or `git diff <ref>` for range/ref
- `resolveRef`: `git rev-parse <ref>` to validate and get full hash

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

- [ ] M path/to/file.ts#L42
- [ ] A path/to/new-file.ts#L1
- [ ] D path/to/deleted.ts

## <Next Chunk>
...
```

4. Commit REVIEW.md

**Create:** `src/prompts/review-process.md`

Instructions for agent to:
1. Read changes in REVIEW.md (comments added by user)
2. Read changes in source files (inline comments with `// REVIEW:` or similar marker)
3. Extract user feedback from both sources
4. Compose TODO.md from collected feedback
5. `git checkout -- .` to reset source changes
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
- If ref provided, include diff of that ref instead of working tree diff

### Phase 6: REVIEW.md File Format

Standard format:

```markdown
# Review: abc123
<!-- base: abc1234567890abcdef1234567890abcdef12345678 -->

## Authentication refactor

Extracts auth logic into dedicated service class.

- [ ] M src/auth/AuthService.ts#L15
- [ ] M src/auth/AuthService.ts#L42
- [ ] A src/auth/types.ts#L1
- [ ] M src/index.ts#L8

## Test updates

Updates tests for new auth service API.

- [ ] M tests/auth.test.ts#L23
- [ ] M tests/auth.test.ts#L89
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

### Phase 8: Delete Legacy `.review` File

Current `.review` file in repo root appears to be from different implementation attempt. Delete as part of this feature or in cleanup phase.

---

## Open Questions

### Should REVIEW.md use line numbers or hunk ranges?

**Recommendation:** Line numbers (`#L42`). Simpler to parse, easier for user to click/navigate, and sufficient granularity. Hunk ranges (`#L42-L67`) are more precise but add parsing complexity without clear benefit — user can see context in the grouped chunks.

<!-- user answers here -->

### How should user inline comments in source code be marked?

**Recommendation:** Use `// REVIEW:` prefix (or `# REVIEW:` for shell/python, `<!-- REVIEW: -->` for HTML/MD). Agent scans for this marker when processing. Alternatives: `// @review`, `// TODO(review):`. The `REVIEW:` prefix is distinct from existing `TODO:` convention and clearly scoped to this feature.

<!-- user answers here -->

### What git diff format for multi-commit ranges?

**Recommendation:** If `<ref>` is a range (e.g., `main..feature` or `HEAD~3..HEAD`), use `git diff <ref>`. If single commit, use `git diff <ref>^..<ref>` (shows changes introduced by that commit). Could also support `git show <ref>` for single commits. Detection: try `git rev-parse <ref>^` — if it fails, treat as range.

<!-- user answers here -->

### Should source file changes be hard-reset or preserved as unstaged?

**Recommendation:** Hard reset (`git checkout -- .`). The user's intent is captured in REVIEW.md comments and TODO.md, so source changes served their purpose. Preserving them creates confusion (are they part of TODO work or leftover?). User can always `git stash` before running `/gtd` if they want to keep experiments.

<!-- user answers here -->
