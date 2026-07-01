# Review: b832132

<!-- base: b8321321b8b8b2f078af9b6d5b39e5c748dc2c7b -->

## Harden await-review gate with STOP block

The await-review prompt previously buried its stop instruction at the end as a
soft directive. Moved it to a prominent ⛔ STOP block at the very top,
explicitly naming the consequence (auto-approve + `gtd: done` commit) if the
agent re-runs gtd without changes. A test asserts the constraint text is present
and precedes the task heading.

- [ ] ./src/prompts/await-review.md#1
- [ ] ./src/Prompt.test.ts#89
