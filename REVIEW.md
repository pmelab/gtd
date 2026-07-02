# Review: be4746d

<!-- base: be4746dca4da448ca7e764c898e6fc970832a7d2 -->

## Always append stop partial on non-advance

`buildPrompt` previously suppressed the stop partial for the `"clean"` state.
Now the stop partial is appended whenever the step does not auto-advance,
regardless of prompt state, so `clean` also gets it.

- [x] ./src/Prompt.ts#211

## Drop redundant re-run/STOP directives from prompts

Each prompt carried a trailing "re-run gtd" or "STOP — do not re-run gtd"
instruction that duplicated guidance now centralized in the stop/auto-advance
partials. These per-prompt tails are removed across the gate prompts.

- [x] ./src/prompts/agentic-review.md#24
- [x] ./src/prompts/clean.md#54
- [x] ./src/prompts/escalate.md#17
- [x] ./src/prompts/fixing.md#20
- [x] ./src/prompts/grilling.md#67
- [ ] ./src/prompts/idle.md#7
