# Task: Rewrite `SKILL.md` + `example.md` for the 16-state machine

Rewrite `SKILL.md` and `example.md` to match the new machine. File-disjoint from
the README task (runs in parallel).

Spec pointers: `STATES.md` (authoritative); `TODO.md` → "Modules to rewrite →
README.md / SKILL.md / example.md"; Resolved Q5 (manual `gtd: transport`, no
subcommand).

## `SKILL.md`

Update the agent-facing skill description so it reflects the 16-state machine,
the flat `gtd:` taxonomy, the steering-file model, and the auto-advance / STOP
behaviour. Remove references to the retired states/prefixes/COMMIT_MSG/checkboxes
/spec-review. Keep it aligned with how the new prompts (package 02
`src/prompts/*.md`) instruct the agent (grilling STOP-for-answers, decompose,
building, fixing, agentic-review, clean, await-review, escalate, idle).

## `example.md`

Rewrite the worked example to walk a feature through the new flow end-to-end:
New Feature → Grilling (with the `<!-- user answers here -->` gate) → Grilled →
Planning → Building → Testing (incl. a red→Fixing loop) → Agentic Review →
Close package → Clean → Await Review → Accept/Done → Idle, showing the flat
`gtd:` commits each step lands. Replace any old-taxonomy commit subjects.

## Files

- Rewrite: `SKILL.md`
- Rewrite: `example.md`

## Acceptance criteria

- [ ] `SKILL.md` describes the 16-state machine + flat taxonomy + steering files;
      no retired concepts remain.
- [ ] `example.md` walks the new end-to-end flow with correct `gtd:` commit
      subjects.
- [ ] `npm run test` + `npm run test:e2e` still pass (docs-only).
