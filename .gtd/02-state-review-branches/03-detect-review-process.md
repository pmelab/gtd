# Task: Detect review-process Branch

## Description

Modify `detect()` in `src/State.ts` to detect review-process branch when REVIEW.md exists with modifications.

## File Paths

- `src/State.ts`

## Dependencies

- Requires `Branch` type to include `"review-process"` (task 01 in this package)

## Implementation

### Detection Logic (after review-create check, before other branches)

1. Check if `REVIEW.md` exists in repo root
2. If exists AND modified in working tree:
   - Read file content
   - Parse `<!-- base: <hash> -->` comment from content
   - If comment missing → throw `Error("REVIEW.md is corrupted: missing base ref. Delete REVIEW.md and re-run with git ref to restart review.")`
   - If present → return state with `branches: ["review-process"]`, `baseRef: parsedHash`
3. If exists AND NOT modified → throw `Error("REVIEW.md exists but has no changes. Edit REVIEW.md to provide feedback, or delete it to abandon review.")`

### Base Ref Parsing

Use regex to extract hash:

```typescript
const match = content.match(/<!--\s*base:\s*([a-f0-9]+)\s*-->/)
if (!match) {
  // throw error
}
const baseRef = match[1]
```

### Modification Detection

Use git porcelain status to check if REVIEW.md is modified:
- Check if `REVIEW.md` appears in `git status --porcelain` output
- Look for ` M REVIEW.md` or `M  REVIEW.md` pattern

### Key Behaviors

- `review-process` is **exclusive**: returns immediately, skips other branch logic
- Check happens AFTER review-create check, BEFORE other branch detection
- Any modification to REVIEW.md counts (checkbox edits, comments, etc.)

## Acceptance Criteria

- [ ] REVIEW.md modified → `branches: ["review-process"]`, `baseRef` populated from comment
- [ ] REVIEW.md exists, not modified → error message: `"REVIEW.md exists but has no changes. Edit REVIEW.md to provide feedback, or delete it to abandon review."`
- [ ] REVIEW.md missing base comment → error message: `"REVIEW.md is corrupted: missing base ref. Delete REVIEW.md and re-run with git ref to restart review."`
- [ ] `review-process` is exclusive (returns immediately, skips other branch logic)
- [ ] REVIEW.md modification detection uses porcelain status check
