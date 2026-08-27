# Spec feedback — 03-editor-integration

The package's four tasks and its acceptance criteria are met in `src/Install.ts`
/ `src/Install.test.ts`: `EDITOR_INTEGRATION` sits between `commandSuite()` and
`PREREQUISITES`, adds no filesystem read, names no editor, carries the three
integration facts, both fresh-repo facts, `gtd.openSteeringFile`, and all three
write guards plus the malformed-config stop-and-report. 59 unit tests,
format:check, lint, typecheck, e2e-inmem and deadcode are all green.

One problem remains.

## README under-describes `gtd install` after this change

`README.md` (the `!gtd install` paragraph, around line 257) enumerates exactly
what the briefing does: "teaches the agent to set the project up, build four
commands for itself ... and ask you what you want before it starts driving." The
briefing now also runs a final step that inspects the user's shell
configuration, may ask them which editor they use, and — on yes — EDITS an
editor config file outside the repository, machine-wide, with no undo. That is
user-visible behavior of a documented command, and the README does not mention
it at all.

Fix: extend that paragraph with one sentence naming the final step — the
briefing offers to wire `gtd lsp` into the user's editor, asks first and names
the exact file, and merges rather than overwrites. Keep it user-facing prose; do
not name `src/*.ts`, the constant, or any specific editor (the settled decision
forbids editor names in the briefing, and the README should not reintroduce the
bias either).
