# Spec feedback — 02 Rewrite the eval docs around configurations

One problem. Everything else in the package checks out: the grep gate is clean,
`evals/run-turn.mjs` really passes `--tools read,write,edit,bash` (a real `pi`
0.84.4 flag, and `read,bash,edit,write` is that version's built-in default, so
no pass rate moves), `evals/baseline.json` is untouched, both settled facts are
stated, and `format:check`/`lint`/`typecheck`/`deadcode`/`test:unit` are green.

## The class picks which half of the configuration RUNS the case, not grades it

`docs/development.md`, "To add a case" paragraph:

> the state's class — planner or coder — picks which half of the configuration
> **grades** it

This is false, and it contradicts the same section three paragraphs earlier.
Grading is the tier-3 `llm-rubric` judge, pinned to `gpt-5.4`
(`evals/run-turn.mjs`'s `JUDGE_MODEL`, `evals/promptfooconfig.yaml`'s
`provider: "openai:chat:gpt-5.4"`) — fixed for every case, independent of class.
What the state's class selects is the model that DRIVES the turn:
`GTD_PLANNERMODEL` vs `GTD_CODERMODEL` (`evals/run-turn.mjs`'s `MODEL_ENV_VAR`,
fed by the provider's `--planner`/`--coder` argv).

Task 2's checkbox asks for exactly this word: "It states the state's class picks
which half of the configuration **runs** it."

Fix: change `grades it` to `runs it` in that clause. Leave the rest of the
sentence alone — "each graded on the tier they actually ship against" is the
spec's own wording and is correct.

`tests/tooling/development-doc.test.ts` does not catch this: its regex
`/class[\s\S]*?picks which half of the configuration/` stops before the verb.
Extend it to pin `runs it` so the word cannot drift back.
