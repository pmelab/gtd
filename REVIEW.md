# Review: 01eb2fb

<!-- base: 01eb2fb4873464b6aa909c6c48185edb9c5c8d4f -->

## Move STOP constraint after content

The `stopPartial` is no longer prepended right after the header. It now emits
after all task/context sections (just before the `autoAdvance` block), so the
STOP instruction is the last thing the agent reads instead of the first.

- [ ] ./src/Prompt.ts#173
- [ ] ./src/Prompt.ts#211

## Flip STOP-ordering test assertions

Assertions that previously required the STOP marker to precede its section
heading now require it to follow. Covers await-review, escalate, idle, and
grilling stop-case.

- [ ] ./src/Prompt.test.ts#92
- [ ] ./src/Prompt.test.ts#201
- [ ] ./src/Prompt.test.ts#207
- [ ] ./src/Prompt.test.ts#215
