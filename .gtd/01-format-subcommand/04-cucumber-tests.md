# Task: Cucumber scenarios for `format` subcommand

Add cucumber.js scenarios under `tests/integration/features/` covering the new
`format` subcommand.

## Scenarios

1. **Formats an unformatted markdown file in place**
   - Given a fresh repo with `TODO.md` containing a single very long line of
     prose (>80 columns).
   - When the test runs `node scripts/gtd.js format TODO.md` in the project.
   - Then `TODO.md` on disk is wrapped to 80 columns, exit code is 0, stdout is
     empty.

2. **Missing file is best-effort**
   - When the test runs `node scripts/gtd.js format does-not-exist.md`.
   - Then exit code is 0 and stderr contains a single
     `gtd: skipped formatting does-not-exist.md: ...` warning.

## Conventions (per AGENTS.md)

- Reuse existing Given steps where possible.
- New steps must be **generic** and expose raw content in scenario text —
  e.g. `Given the file <path> contains:` followed by a fenced docstring.
- Inline setup logic into step definitions; one step per commit-style action.

## Acceptance criteria

- [ ] New `.feature` file (or scenarios appended to `formatting.feature` if it
      fits) covers both scenarios.
- [ ] New step defs added to `tests/integration/support/steps/` only if no
      reusable step exists.
- [ ] `npm run build && npm run test:e2e` passes for the new scenarios.

## Files

- `tests/integration/features/formatting.feature` (edit) or new
  `format-subcommand.feature`
- `tests/integration/support/steps/*.steps.ts` (edit/new as needed)
