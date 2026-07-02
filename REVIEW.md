# Review: 87e0f69

<!-- base: 87e0f6902bd04b0c1c70dabdc5618ce85100d8ba -->

## Sentinel is not a substitute for writing the plan

Adds a clarifying sentence to the intro so the "no open questions" sentinel is
understood to mean the plan is fully developed and ready to decompose, never a
shortcut that skips writing the plan.

- [ ] ./src/prompts/grilling.md#21

## Always develop TODO.md into a concrete plan

Reworks the planning-subagent instructions: inserts a new first step mandating
that every iteration replace the seed/captured-input template with a real,
codebase-grounded implementation plan (regardless of open questions), renumbers
the following steps, and gates the sentinel behind the plan actually holding a
concrete plan.

- [ ] ./src/prompts/grilling.md#31
- [ ] ./src/prompts/grilling.md#54
