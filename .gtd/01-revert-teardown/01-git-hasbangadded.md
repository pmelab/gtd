# Reduce `grepBangAdded` to boolean `hasBangAdded`; delete `BangComment` + dead reset ops

Reduce the `!!` harvest from a per-comment `BangComment[]` extraction to a single
boolean signal, delete the now-dead `BangComment` struct, and delete the two
unused reset methods (`checkoutTracked`, `cleanUntracked`) — the new revert-based
teardown is entirely prompt-level (Q3), so they have no remaining caller.

This task owns the full contract of these `Git.ts` methods, so it touches BOTH
`src/Git.ts` and its unit tests `src/Git.test.ts`. They must change together —
the old signatures and the `BangComment` type disappear.

## Files (exclusive to this task)

- `src/Git.ts`
- `src/Git.test.ts`

## What to do — `src/Git.ts`

1. **`hasBangAdded` replaces `grepBangAdded`:**
   - Interface decl (~line 24): replace
     `readonly grepBangAdded: (baseRef: string) => Effect.Effect<ReadonlyArray<BangComment>, Error>`
     with
     `readonly hasBangAdded: (baseRef: string) => Effect.Effect<boolean, Error>`.
   - Impl (~223-292): keep the untracked intent-to-add + reset trick and the
     `git diff <baseRef> -- ':!REVIEW.md' ':!TODO.md'` scan (no second ref —
     compares the ref to the WORKING TREE so uncommitted edits are picked up).
     Return `true` on the FIRST added (`+`) line whose content matches the
     existing pattern `/(\/\/|#|<!--)\s*!!/`, else `false`. DROP all hunk-header
     parsing, the `currentFile`/`lineCounter` bookkeeping, the `file`/`line`/
     `text` extraction, and the `results` array. Keep the `+++ ` file-header
     guard only insofar as needed to avoid matching it (i.e. skip lines starting
     with `+++ `). The terminal `Effect.catchAll(() => Effect.succeed(...))`
     must now yield `false`, and the empty-diff early return must be `false`.
   - Update the impl doc comment to describe a boolean "any reviewer-added `!!`?"
     check rather than "harvest comments".

2. **Delete `BangComment`** — remove the `BangComment` interface (~27-33)
   entirely. It must no longer be exported (Events.ts will drop its import in a
   sibling task; both land in this same commit).

3. **Delete dead reset ops** — remove from the `GitOperations` interface and the
   `Live` impl:
   - `checkoutTracked` (interface ~line 12; impl ~99-100)
   - `cleanUntracked` (interface ~line 13; impl ~102)

   Leave `lastCloseCommit` (~147-159) and its grep
   `^chore\(gtd\): close approved review for` UNTOUCHED — the new teardown anchor
   commit must match it exactly.

## What to do — `src/Git.test.ts`

- Delete the `describe("checkoutTracked", …)` block (~87-103) and the
  `describe("cleanUntracked", …)` block (~105-117).
- Rewrite `describe("grepBangAdded", …)` (~355-431) to `describe("hasBangAdded", …)`:
  for each existing scenario, assert the BOOLEAN result instead of a
  `BangComment[]`:
  - "harvests !! added (uncommitted) after baseline" → `expect(result).toBe(true)`.
  - "does NOT harvest !! that existed at baseline" → `expect(result).toBe(false)`.
  - "recognises !! across // # <!-- comment syntaxes" → `expect(result).toBe(true)`.
  - "excludes REVIEW.md and TODO.md even with added !!" → `expect(result).toBe(false)`.
  - "returns [] when no !! added after baseline" → `expect(result).toBe(false)`.
  - "harvests !! in a NEW untracked file added after baseline" → `expect(result).toBe(true)`.

  Drop all `result[0]!.file` / `.line` / `.text` assertions. Update describe/it
  titles to "detects" / "does not detect" wording as appropriate.

## Constraints

- Do NOT touch any other file. `src/Events.ts` (the only caller) is migrated in
  a sibling task within this same package/commit; both must compile together.
- `npm run test` must pass for the package as a whole.

## Acceptance criteria

- [ ] `GitOperations.hasBangAdded(baseRef): Effect<boolean, Error>` exists; no
      `grepBangAdded` remains anywhere in `src/Git.ts`.
- [ ] The `BangComment` interface is deleted from `src/Git.ts` and no longer
      exported.
- [ ] `checkoutTracked` and `cleanUntracked` are removed from both the interface
      and the `Live` impl.
- [ ] `lastCloseCommit` and its grep pattern are unchanged.
- [ ] `src/Git.test.ts` has no `checkoutTracked`/`cleanUntracked` describe blocks
      and a `hasBangAdded` describe asserting `true`/`false`.
- [ ] No `BangComment` reference remains in `src/Git.ts` or `src/Git.test.ts`.
