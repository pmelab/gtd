feat(gtd): delete .gtd/ on the last package to skip the cleanup round-trip

When `packages.length === 1` at render time, the execute prompt now also
instructs removing the empty `.gtd/` directory in the same step the last package
is committed, so the next run resolves straight to `human-review` instead of the
`cleanup` state. The multi-package execute prompt omits this instruction. The
`cleanup` leaf and its prompt are kept as a vestigial safety net for a stray
empty `.gtd/` — not removed.

Post-merge integration steps (orchestrator):
- run vitest (`Prompt.test.ts`: single-package prompt includes the `.gtd/`
  removal instruction, multi-package omits it; cleanup leaf test unchanged) —
  green
- run cucumber (single- vs multi-package execute scenarios) — green
- `npm run build` to regenerate `scripts/gtd.js`
- README/SKILL doc updates are package 04

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
