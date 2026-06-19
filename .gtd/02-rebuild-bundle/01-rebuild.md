# Rebuild bundled script

## Description

Run `npm run build` to regenerate `scripts/gtd.js` with the updated prompt content from package 01.

## Command to Run

```bash
npm run build
```

## Files Affected

- `scripts/gtd.js` — will be regenerated with updated prompts embedded

## Verification

After running `npm run build`, verify the new prompt text is embedded:

```bash
grep -c "Open Questions.*TOP" scripts/gtd.js
grep -c "Answered Questions" scripts/gtd.js
```

Both should return `> 0`.

## Acceptance Criteria

- [ ] `npm run build` completes successfully
- [ ] `scripts/gtd.js` contains text about `## Open Questions` at TOP of file
- [ ] `scripts/gtd.js` contains text about `## Answered Questions`
- [ ] `npm test` passes (unit tests)
- [ ] `npm run test:e2e` passes (integration tests with updated fixtures)
