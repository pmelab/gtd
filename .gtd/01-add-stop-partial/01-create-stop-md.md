# Create `src/prompts/partials/stop.md`

Create a new partial file that contains the state-neutral ⛔ STOP banner. This
partial will later be injected centrally by `buildPrompt` for every human-gate
state (`autoAdvance: false` and state is not `clean`).

## Acceptance criteria

- [ ] File `src/prompts/partials/stop.md` exists
- [ ] File contains exactly the banner text specified below (no trailing blank
      line needed beyond the file's own newline):
      `⛔ **STOP — do not re-run \`gtd\`.\*\* This is a human gate. Only the
      user may resume this step. Re-running \`gtd\` now with no changes will
      loop or advance without human input.`
- [ ] The wording is state-neutral (no mention of "await review", "escalate",
      etc.)
- [ ] All existing tests remain green (no production code changes in this
      package)

## Files

- **Create**: `src/prompts/partials/stop.md`

## Constraints / edge cases

- Do NOT modify any `.ts` files or other `.md` prompt files in this package —
  this package is file-disjoint from packages 2–4.
- The existing partial `src/prompts/partials/auto-advance.md` is the structural
  mirror; match its style (short imperative paragraph, no heading).
- The file is imported as a raw string by Vite/TypeScript; ensure it ends with a
  newline (standard text file convention).
