## Task: Build every unchecked item in `TODO.md`

The last commit finalized `TODO.md` and the working tree is clean. Implement
every unchecked checklist item (`- [ ] …`) under any `## Action Items` /
`## Tasks` / similar heading.

Process items strictly in document order. For each one:

1. Use plan mode to sketch the change, spawn sub-agents for parallelizable
   research or implementation, and lean on every capability you have. Long
   tasks are expected.
2. Implement the change end-to-end.
3. Run the project's test suite. Fix any failures (each fix may itself be one
   or more commits).
4. Mark the item as `- [x]` in `TODO.md`.
5. Commit everything — code change + `TODO.md` tick — with a Conventional
   Commit message that describes the change (not the TODO item ID).

Ignore items under `## Open Questions` — those are unresolved design questions,
not implementation tasks.

When every checklist item is `- [x]`:

6. Delete `TODO.md`.
7. Commit with `chore: remove completed plan`.
