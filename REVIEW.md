# Review: a19c084

<!-- base: a19c084912ad32e3f0b929450c128d2b2512410c -->

## Configured testCommand is edge-only; prompts discover tests themselves

Reverts package 04's "`.gtdrc` `testCommand` config takes precedence" prose from
the four agent-run test-gate prompts, back to generic "determine the command
from AGENTS.md / package.json / Makefile" wording. The resolved `testCommand`
now drives only the deterministic edge run (`human-review` / `execute`); prompts
where an agent runs tests are free to figure out the appropriate command per
task. No `{{TEST_COMMAND}}` injection and no `buildPrompt` change — the original
direction was reversed during review.

- [ ] ./src/prompts/execute-simple.md#37
- [ ] ./src/prompts/close-review.md#3
- [ ] ./src/prompts/verified.md#3
- [ ] ./src/prompts/escalate.md#8

## Document why Config.ts hand-rolls walkUp + deepMerge

Expands the comment above `deepMerge` to record the finding that cosmiconfig v9
`search()` stops at the first config it finds and has no native cross-level
auto-merge (only the manual `$import` key), so the hand-rolled walk + merge with
innermost-wins semantics is intentional. No logic change.

- [ ] ./src/Config.ts#64

## Review bookkeeping

The previous review's `REVIEW.md` is removed (carried in the net diff from the
base because the base commit was the prior review-creation commit). No product
impact.

- [ ] ./REVIEW.md#1

## Regenerated bundle

`scripts/gtd.js` rebuilt so the shipped CLI emits the reverted prompt prose. Not
reviewed line-by-line.

- [ ] ./scripts/gtd.js#1
