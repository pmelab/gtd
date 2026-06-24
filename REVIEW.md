# Review: ae9fa66

<!-- base: ae9fa66593f8852c1172198bd6d9df4c7838d567 -->

Wording-only cleanup (review feedback, option C): the `auto-advance` tag already
appends the `auto-advance` partial ("Re-run gtd immediately…") to every
auto-advancing leaf's prompt, so the body sentence in the three producer prompts
that also said "Re-run gtd — the next cycle commits…" duplicated the directive.
Each body sentence is trimmed to state only the marker/commit mechanics; the
appended partial owns the single re-run directive. No machine/behavior change.

## Trim the three auto-advance producer prompts

- `human-review.md`: drop "re-run gtd" from the closing line and fix the gate
  name — it stops at `await-review`, not "human-review".
- `new-todo.md` / `modified-todo.md`: drop the "Re-run gtd — " prefix, keep the
  "The next cycle commits … and deletes the marker." mechanics.

- [ ] ./src/prompts/human-review.md#70
- [ ] ./src/prompts/new-todo.md#72
- [ ] ./src/prompts/modified-todo.md#81

## e2e assertion follows the reworded phrasing

The `auto-advance.feature` human-review scenario asserts the new "the next
cycle's edge commits" phrasing (and still `does not contain "STOP"`). e2e:
113/113 pass.

- [ ] ./tests/integration/features/auto-advance.feature#80
