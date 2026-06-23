# Follow-up: inject test command into prompts + config cleanups

Feedback from the review of the config system (base `32a006f`).

## Inject the resolved `testCommand` into prompts (don't tell the agent to read `.gtdrc`)

From the REVIEW.md note on the "Test-command discovery prose points at .gtdrc"
chunk:

> the prompts should not instruct the agent to read the test command from
> .gtdrc, but should just print it right into the prompt. like with models
> above.

Package 04 added prose to several prompts telling the agent that the `.gtdrc`
`testCommand` "takes precedence" when determining the test command. That is the
wrong mechanism — it makes the agent responsible for reading config. Instead,
gtd should resolve `testCommand` from `ConfigService` and **inject the concrete
command directly into the prompt text**, exactly like the `{{MODEL}}` injection
added in package 03.

- Add a `{{TEST_COMMAND}}` (or similar) placeholder to the prompts that
  reference test-command discovery, and substitute the resolved
  `ConfigService.testCommand` in `buildPrompt` (`src/Prompt.ts`).
- Revert the "read the `.gtdrc` testCommand / takes precedence" prose added in
  package 04 to: `src/prompts/execute-simple.md` (Step 2 testing-subagent),
  `src/prompts/close-review.md`, `src/prompts/verified.md`,
  `src/prompts/escalate.md`. These should print the actual command, not point at
  the config file.
- Decide whether the edge-run leaves (`human-review`, `execute`) need the
  command in-prompt at all (the edge already runs it deterministically) versus
  the leaves where an agent runs tests itself — inject only where an agent
  actually needs to invoke the command.

## Research whether cosmiconfig can merge config natively; drop hand-rolled `deepMerge` if so

Verbatim `!!` follow-up from `src/Config.ts` (on the `deepMerge` helper):

> !! research if cosmiconfig has capabilities for merging already. if yes,
> remove this and rely on cosmiconfig alone (even if it does not 100% meet the
> requirements)

`src/Config.ts` currently hand-rolls a recursive `deepMerge` over the per-level
config objects found while walking cwd→home. Investigate whether cosmiconfig (or
a small companion it already pulls in) can perform the multi-level merge itself.
If it can, remove the custom `deepMerge` and rely on cosmiconfig — acceptable
even if the built-in merge doesn't 100% match the current
innermost-wins/merge-all-levels semantics.

## Note: `new-todo` and `modified-todo` are both "grilling"

Verbatim `!!` follow-up from `src/Config.ts` (on the `ModelState` type):

> !! new-todo and modified-todo are both "grilling"

Both `new-todo` and `modified-todo` correspond to the same `grilling` planning
status. This suggests the per-state model override surface may be finer than
necessary — `new-todo` and `modified-todo` arguably want the same model. Review
whether the `models.states` keys should collapse these two into a single
`grilling` concept (in `ModelState`, the tier mapping, the schema, the README,
and the injection sites), or whether keeping them distinct is worth it.
