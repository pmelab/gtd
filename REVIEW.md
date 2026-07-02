# Review: d9182fd

<!-- base: d9182fd6cab1038474882e24f2e25d71b233fbb4 -->

## Grilling prompt: require a concrete plan before the sentinel

The grilling prompt previously let the subagent write the "no open questions"
sentinel while `TODO.md` still held only the seed / captured-input template,
allowing convergence with no real plan. This change reframes the sentinel as
"plan is fully developed and ready to decompose" and adds an explicit first-step
instruction to always develop `TODO.md` into a concrete implementation plan on
every iteration. The subsequent numbered list is renumbered (1→2, 2→3, 3→4, 4→5)
to accommodate the new leading step, and the final step gains a guard that the
sentinel may only be written once a concrete plan exists.

- [ ] ./src/prompts/grilling.md#21
- [ ] ./src/prompts/grilling.md#31
- [ ] ./src/prompts/grilling.md#53
