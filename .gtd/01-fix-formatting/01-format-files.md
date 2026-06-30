# Format all tracked files with Prettier

## Description

CI's `Format check` step (`npm run format:check` → `prettier --check .`) fails
because 17 tracked files are not Prettier-formatted. Run the existing format
script to fix them in place, then verify the check passes.

This is a mechanical, formatting-only change — no logic edits.

## Steps

1. Run `npm run format` (`prettier --write .`).
2. Run `npm run format:check` (`prettier --check .`) — must exit 0.

## Affected files (per investigation; verify actual set with the check)

- `AGENTS.md`, `example.md`, `README.md`, `SKILL.md`
- `src/Config.test.ts`, `src/Events.test.ts`, `src/Events.ts`, `src/Git.ts`
- `src/Machine.test.ts`, `src/Machine.ts`, `src/Prompt.ts`
- `src/prompts/building.md`, `src/prompts/clean.md`,
  `src/prompts/decompose.md`, `src/prompts/fixing.md`
- `STATES.html`, `STATES.md`

## Acceptance criteria

- [ ] `npm run format` has been run
- [ ] `npm run format:check` exits 0 (no unformatted files)
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Changes are formatting-only (no semantic/logic changes)

## Constraints

- Do NOT hand-edit content beyond what Prettier produces.
- Do NOT touch `.github/workflows/*`, `package.json`, or husky config (those
  belong to later packages).
- Leave all changes uncommitted.
