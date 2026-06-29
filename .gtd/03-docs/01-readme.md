# Task: Rewrite `README.md` for the 16-state machine

Rewrite `README.md` to document the new machine: the 16 states, the 3-layer
detection (transport pre-pass → steering-file precedence → HEAD bucket), the
flat `gtd: <phase>` commit taxonomy, the test/review fix loops + escalation,
package close, and the replay/distribute invariants. Remove every reference to
the retired design (18 leaf states, `plan|review|chore(gtd):` prefixes, `Gtd-*`
trailers, `COMMIT_MSG.md`, REVIEW.md checkboxes, spec-review, `xstate`,
`MAX_NO_AGENT_HOPS`).

Per the user's global instruction, the README must reflect the shipped behaviour
after the cutover.

Spec pointers: `STATES.md` (authoritative — the README is its user-facing
projection); `TODO.md` → "Modules to rewrite → README.md / SKILL.md /
example.md", the state→action→commit table, and Resolved Q5 (the **manual**
`gtd: transport` handoff — `git add -A && git commit -m "gtd: transport"`, no
subcommand).

## Cover

- The steering files (`TODO.md`, `REVIEW.md`, `FEEDBACK.md`, `ERRORS.md`,
  `.gtd/`) and that they are authoritative + never auto-GC'd.
- The commit taxonomy (boundary vs mid-phase) and the flat `gtd:` subjects.
- The precedence ladder (0–7) and the illegal-combination hard-errors.
- Each of the 16 states: condition, deterministic action, commit(s), advance.
- The test-fix loop (`fixAttemptCap`), the review-fix loop + agentic review
  (`reviewThreshold`, `agenticReview` kill-switch), Escalate + ERRORS.md reset.
- Config: `testCommand`, `fixAttemptCap`, `reviewThreshold`, `agenticReview`,
  `models` tiers/overrides, cosmiconfig walk-up.
- The manual `gtd: transport` cross-machine handoff (no subcommand) and the
  single-writer/linear-branch (first-parent) distribute model.
- That `format` is the only subcommand.

## Files

- Rewrite: `README.md`

## Acceptance criteria

- [ ] README documents all 16 states, the flat `gtd:` taxonomy, the precedence
      ladder, the fix/review loops + caps, and the manual transport handoff.
- [ ] No retired concepts remain (old prefixes, trailers, COMMIT_MSG, checkboxes,
      spec-review, xstate, MAX_NO_AGENT_HOPS).
- [ ] `npm run test` + `npm run test:e2e` still pass (docs-only; no code change).
