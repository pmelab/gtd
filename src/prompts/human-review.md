## Task: Generate REVIEW.md after successful verification

The working tree is clean, tests passed, and the `human-review` step is now
producing `REVIEW.md` for the un-reviewed commits since the computed base.
Context contains `refDiff`: output of `git diff <base> HEAD`.

### Steps

1. **Parse `refDiff`** — extract all changed hunks with their file paths and
   starting line numbers.

2. **Group hunks semantically** — cluster hunks that belong to the same logical
   concern (same feature, same refactor, same fix). Hunks in different files can
   belong to the same chunk if they serve the same purpose. Aim for the smallest
   number of chunks that still makes the review navigable.

3. **Determine the short hash** — take the first 7 characters of the base ref
   (the full hash embedded in `<!-- base: -->` comes from
   `git rev-parse <ref>`).

4. **Write `REVIEW.md`** in this exact format:

   ```markdown
   # Review: <short-hash>

   <!-- base: <full-hash> -->

   ## <Chunk Title>

   <Explanation of what this chunk does and why>

   - [ ] ./path/to/file.ts#42
   - [ ] ./path/to/file.ts#99

   ## <Another Chunk Title>

   <Explanation>

   - [ ] ./path/to/another.ts#1
   ```

   **Format rules:**
   - `<short-hash>` = first 7 chars of the base ref
   - `<!-- base: <full-hash> -->` = full SHA of the base ref (machine-readable,
     used by later steps to recompute the diff)
   - File paths are relative, prefixed with `./`
   - Line numbers (`#42`) are creation-time hints only — they will drift as the
     file changes and must not be treated as authoritative
   - One checkbox per hunk location; do not merge multiple hunks from the same
     file into a single checkbox unless they are adjacent and inseparable
   - Chunk titles are short imperative phrases (≤ 6 words)
   - Chunk explanations describe _what_ changed and _why_, not just where

5. **Format REVIEW.md** — run `node scripts/gtd.js format REVIEW.md` (use the
   same `scripts/gtd.js` path you invoked to get this prompt) to normalize
   formatting.

6. **Leave `REVIEW.md` uncommitted** — do **not** commit.

Re-run gtd — the next cycle commits `REVIEW.md` with the message
`review(gtd): create review for <short-hash>` (`<short-hash>` derived by the
edge from the base ref), then stops at the `await-review` gate for the user to
work through it.
