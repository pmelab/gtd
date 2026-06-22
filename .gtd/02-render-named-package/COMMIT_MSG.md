feat(gtd): name the next package and inline its task contents in the execute prompt

Rewrite the execute prompt to pinpoint the single lowest-numbered package and
inline the full contents of its task .md files (noting its COMMIT_MSG.md) so the
prompt is self-contained — the agent no longer opens `.gtd/` or picks a package.
`execute.md` drops the "EXACTLY ONE / lowest-numbered / pick the first" framing;
`Prompt.ts` renders the named package and inlined task bodies (fenced via
`fenceFor`) for the execute leaf only. `execute` still wins via `hasPackages`.

Post-merge integration steps (orchestrator):
- run vitest (`Prompt.test.ts`: updated execute test asserts the named package +
  inlined content, no "EXACTLY ONE/lowest-numbered") — green
- run cucumber (`execute-gate.feature`, `branches.feature`: stdout names the
  package and contains its inlined task body) — green
- `npm run build` to regenerate `scripts/gtd.js`
- README/SKILL doc updates are package 04

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
