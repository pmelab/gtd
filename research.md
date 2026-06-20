# Research: Review Feature Implementation Analysis

## Summary

Integrated 4 answered questions into TODO.md plan body. Added 4 new high-stakes
questions focused on edge cases: conflicting REVIEW.md + ref, empty feedback
handling, stale base ref detection, and corrupted REVIEW.md recovery.

## Findings

1. **Codebase follows Effect-TS patterns** — GitService uses Context.Tag pattern
   with Layer.effect for DI. New methods (`diffRef`, `resolveRef`,
   `checkoutAll`) follow same pattern.

2. **State detection is branching-based** — `Branch` union type drives which
   prompt sections get included. Adding `"review-create"` and `"review-process"`
   branches follows established pattern exactly.

3. **Prompts are static markdown** — Imported at build time, no dynamic
   generation. Context injected via `buildContext()` which reads from State.

4. **Tests use cucumber.js with world.ts** — `GtdWorld` class provides
   `runGtd()`, `repoFile()`, `execInRepo()` helpers. Feature files go in
   `tests/integration/features/`.

5. **CLI is minimal** — `main.ts` just chains
   `detect() -> buildPrompt() -> stdout`. Adding ref argument parsing is
   straightforward.

## Sources

- Kept: `src/State.ts` — Branch type definition, detection logic pattern
- Kept: `src/Git.ts` — GitOperations interface, Layer.effect pattern
- Kept: `src/Prompt.ts` — SECTIONS mapping, buildContext structure
- Kept: `src/main.ts` — CLI entry point pattern
- Kept: `tests/integration/support/world.ts` — E2E test helpers

## Gaps

- No existing tests in `tests/integration/features/` to reference — directory
  may not exist yet
- Unclear if `git diff <ref> HEAD` handles merge commits correctly (may need
  `--no-merges` or specific format)

## Questions Integrated (removed from Open Questions)

1. **File path format**: `./path/to/file.ts#42` (relative, line number only)
2. **User inline comments**: ALL changes as feedback, no marker convention
3. **Git diff format**: `git diff <ref> HEAD` only, no ranges
4. **Hard reset**: `git checkout -- .` after processing

## New Questions Added

1. REVIEW.md + ref conflict precedence
2. Empty feedback (checkbox-only) handling
3. Stale base ref detection strategy
4. Corrupted REVIEW.md (missing base comment) recovery
