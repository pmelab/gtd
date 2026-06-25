# Apply formatting cleanups from review

Apply the style edits the reviewer made to `src/Machine.ts`:

- Remove the extra blank line between `EdgeAction` type and `GtdContext`
  interface (around line 130).
- Reformat the `isFixTestsLoop` guard (around line 311) from a single long line
  to the multi-line style used by the surrounding guards.
- Reformat the `packageCommitMsg` ternary in the `execute` intent branch (around
  line 418) from a single long line to multi-line for consistency.

Only `src/Machine.ts` changes; no logic changes.
