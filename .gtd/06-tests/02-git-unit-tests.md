# Task: Create Unit Tests for New Git Methods

## Description

Create unit tests for the 5 new Git service methods added in package 01.

## File Paths

- `src/Git.test.ts` (create new file)
- Reference: `src/Prompt.test.ts` for vitest patterns

## Dependencies

- Requires Git methods from package 01

## Implementation

### Methods to Test

1. **`diffRef(ref: string)`**
   - Returns diff output between ref and HEAD
   - Test with valid ref
   - Test output format

2. **`resolveRef(ref: string)`**
   - Returns full hash for valid ref
   - Errors for invalid ref
   - Test with short hash, branch name, HEAD~1, etc.

3. **`checkoutTracked()`**
   - Resets modified tracked files
   - Test that modifications are discarded

4. **`cleanUntracked()`**
   - Removes untracked files and directories
   - Test that untracked files are deleted

5. **`diffStatRef(ref: string)`**
   - Returns stat output
   - Returns empty string when no changes

### Test Structure

Follow vitest patterns from `src/Prompt.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { Effect } from "effect"
// ... imports

describe("GitService", () => {
  describe("diffRef", () => {
    it("returns diff between ref and HEAD", async () => {
      // setup test repo
      // create commits
      // call diffRef
      // verify output
    })
  })

  describe("resolveRef", () => {
    it("returns full hash for valid ref", async () => {
      // ...
    })

    it("errors for invalid ref", async () => {
      // ...
    })
  })

  // ... other methods
})
```

### Test Setup

Each test needs:
- Temporary git repository
- Initial commit(s) for ref testing
- Cleanup after test

Consider using `beforeEach`/`afterEach` for repo setup/teardown.

## Acceptance Criteria

- [ ] Test file created at `src/Git.test.ts`
- [ ] Each of the 5 new methods has at least one test
- [ ] Tests use vitest patterns consistent with `src/Prompt.test.ts`
- [ ] Tests cover error cases (e.g., `resolveRef` with invalid ref)
- [ ] Tests run successfully with `npm test` or `pnpm test`
