# Review: b8e077d

<!-- base: b8e077d6b05f300feb9b26cb28f0859d6f620c68 -->

## Extract reusable STOP partial

The bespoke ⛔ paragraph in `await-review.md` was state-specific and duplicated
the intent that exists (or was missing) for all other human-gate states. Moving
it to `src/prompts/partials/stop.md` gives a single source of truth with
slightly generalised wording ("This is a human gate" rather than review-specific
copy).

The old text warned about `auto-approve the review` — a detail that only makes
sense in the review state. The new wording generalises to "loop or advance
without human input", which is accurate for `escalate`, `idle`, and the
`grilling` stop-case too.

- [ ] ./src/prompts/partials/stop.md#1
- [ ] ./src/prompts/await-review.md#1

## Gate STOP banner in `buildPrompt`

`buildPrompt` now prepends the stop partial for every non-auto-advance,
non-`clean` prompt state. The condition
`!result.autoAdvance && promptState !== "clean"` is correct: `clean` is excluded
because it is not a blocking human gate (no action is required), and
auto-advance states must not show the banner because the machine is about to
proceed on its own.

One subtlety: `stopPartial` is pushed with a trailing `""` separator before
`buildContextBlock`, matching the blank-line convention used everywhere else in
`parts`. This is fine structurally but means the banner sits between the header
and the context block rather than at the very top — reviewers should confirm
this ordering is intentional for readability.

- [ ] ./src/Prompt.ts#174

## Update and extend STOP banner tests

The removed assertion (`"auto-approve the review"`) matched the old
review-specific wording that no longer exists in the partial, so its removal is
correct.

The five new `describe("STOP banner")` tests cover the meaningful branches:

- `escalate` and `idle` positively assert the banner appears before the prompt
  body
- `grilling` stop-case asserts the same
- `clean` asserts the banner is absent despite `autoAdvance: false`
- the auto-advance loop asserts the banner is absent for all seven auto-advance
  states

Coverage looks complete for the new condition. One minor observation: the
auto-advance test includes `result("clean")` twice (once standalone, once in the
loop) — redundant but harmless.

- [ ] ./src/Prompt.test.ts#89
- [ ] ./src/Prompt.test.ts#194
