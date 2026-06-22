feat(gtd): inline task-file contents into the packages fact

Widen `GtdPackageFact` with `taskContents` (full raw contents of each task .md,
sorted parallel to `tasks`) and `hasCommitMsg`, and populate both in the Effect
edge `getPackages`. Machine change is types-only — the wider fact flows through
`applyPayload` onto `GtdContext.packages` unchanged; no new guard, state, or IO.
This is the data the execute prompt will render in the next package.

Post-merge integration steps (orchestrator):
- run vitest (`Machine.test.ts` flow-through test; edge fixture test if a seam
  exists) and the cucumber suite — all green
- `npm run build` to regenerate the checked-in `scripts/gtd.js` bundle (e2e runs
  against the rebuilt bundle)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
