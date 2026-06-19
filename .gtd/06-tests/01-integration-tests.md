# Task: Create Integration Tests for Review Feature

## Description

Create Cucumber scenarios for the review feature covering all user flows and error cases.

## File Paths

- `tests/integration/features/review.feature` (create new file)
- Reference: `tests/integration/features/branches.feature` for existing step patterns

## Implementation

### Scenarios to Cover

1. **`gtd <valid-ref>` creates REVIEW.md and commits it**
   - Given clean repo with commits
   - When run gtd with valid ref argument
   - Then REVIEW.md created with expected format
   - And commit created with `review(gtd):` prefix

2. **`gtd <invalid-ref>` exits with error**
   - Given clean repo
   - When run gtd with invalid ref
   - Then error message about invalid ref

3. **Modified REVIEW.md triggers review-process branch**
   - Given REVIEW.md exists with base comment
   - And REVIEW.md is modified
   - When run gtd
   - Then review-process branch detected

4. **Review process creates TODO.md, deletes REVIEW.md, resets source changes**
   - Given REVIEW.md with modifications
   - And source files with feedback edits
   - When run gtd
   - Then TODO.md created
   - And REVIEW.md deleted
   - And source changes reset

5. **Review process commits TODO.md and REVIEW.md deletion together**
   - Verify single commit contains both changes

6. **Error when REVIEW.md exists and ref arg provided simultaneously**
   - Given REVIEW.md exists
   - When run gtd with ref argument
   - Then error: "REVIEW.md already exists..."

7. **Checkbox-only REVIEW.md (no text feedback) is processed as valid**
   - Given REVIEW.md with only checkbox changes
   - When run gtd
   - Then review processed successfully

8. **Error when `<!-- base: -->` comment is missing from REVIEW.md**
   - Given REVIEW.md without base comment
   - And REVIEW.md is modified
   - When run gtd
   - Then error: "REVIEW.md is corrupted..."

9. **New untracked files created during review are cleaned up**
   - Given REVIEW.md exists
   - And untracked file created during review
   - When run gtd
   - Then untracked file removed

10. **Error when ref arg provided with dirty working tree**
    - Given repo with uncommitted changes
    - When run gtd with ref argument
    - Then error: "Commit or stash changes..."

11. **Error when REVIEW.md exists but is not modified**
    - Given REVIEW.md exists (committed, clean)
    - When run gtd
    - Then error: "REVIEW.md exists but has no changes..."

12. **Error when `git diff <ref> HEAD` is empty**
    - Given ref points to HEAD
    - When run gtd with that ref
    - Then error: "No changes between..."

### Step Patterns

Use composable Given steps from `branches.feature`:
- `Given a git repository`
- `Given a file "X" with content "Y"`
- `Given the file is committed`
- `When I run gtd`
- `Then the output should contain "X"`

Add new steps as needed:
- `When I run gtd with ref "X"`
- `Given REVIEW.md with base "X"`
- `Then REVIEW.md should not exist`

## Acceptance Criteria

- [ ] File created at `tests/integration/features/review.feature`
- [ ] All 12 scenarios present
- [ ] Scenarios use composable Given/When/Then steps
- [ ] Step definitions don't require new one-off helpers — reuse or minimally extend existing steps
- [ ] Actual file content/changes exposed in scenario text (not hidden behind abstract names)
