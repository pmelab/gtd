# Spec feedback: 01-eval-harness-on-the-gateway

The harness rewrite itself is done and verified. One task in the package was
never performed: the baseline was not re-recorded.

## Blocking: `evals/baseline.json` still holds the placeholder floor

`evals/baseline.json` is byte-identical to what the previous process round
committed — `git log --oneline -- evals/baseline.json` shows its last touch is
`1cbcefa9`, before this package was built, and this package's own diff
(`git diff --stat b023600c..HEAD`) does not list the file at all.

Its `recordedAt` is still the sentence
`"unrecorded — placeholder floor, never produced by a real \`npm run eval\` run;
re-record with \`npm run eval:baseline\` before trusting
it"`, and all four cells are the unverified `4/4`.

That fails three acceptance boxes verbatim:

- `A real \`npm run eval\` completes`
- `\`npm run eval:baseline\` writes a \`recordedAt\` that is a timestamp rather
  than the placeholder sentence`
- the task-list box `evals/baseline.json`'s `recordedAt` is an ISO timestamp,
  not the placeholder sentence

It also breaks the requirement's own stated reason: the labels `planner` and
`cheap` were deliberately kept so the cell keys stay valid, and the spec says in
the same breath that **a stale-but-key-compatible baseline is worse than a
missing one, because it passes silently.** That is exactly the state the tree is
in right now — `compare()` will gate every future run against a 4/4 floor nobody
measured.

**Fix:** run `npm run eval` to completion (16 trials: 2 providers x 2 variants x
`--repeat 4`, `--max-concurrency 2`, 600s ceiling each), read the printed
matrix, then run `npm run eval:baseline` so the write goes through
`compare-baseline.mjs` (which runs `OXFMT_BIN` on write) rather than by hand.
Then confirm `npm run format:check` still passes.

Do not hand-edit `recordedAt` to a timestamp — the numbers below it have to be
the measured ones, and the file has to be produced by the recorder, not typed.

Expect the recorded cells to come in below `4/4`. A live single trial of the
`violation` variant on `claude-4-5-haiku` returned `structurallyOk: false`,
because the turn also modified `test.ts` and that lands as `otherFilesChanged`.
That is a grading result, not a harness break — record what the run measures, do
not tune the floor to `4/4`.

## Everything else in the package verified clean

For the fix turn's benefit, these were checked and need no work:

- One real trial runs end to end with `ANTHROPIC_API_KEY` unset:
  `EVAL_CLEAN=1 node evals/run-turn.mjs --model claude-4-5-haiku violation`
  exits 0 and prints its JSON line.
- `grep -rn -i anthropic evals/` returns nothing; `claude` appears in
  `run-turn.mjs` only as the `JUDGE_MODEL` string `"claude-4-5-sonnet"`.
- `claude-4-5-opus`, `claude-4-5-haiku`, and `claude-4-5-sonnet` are all listed
  by `GET $GTD_EVALS_URL/models` (43 ids served).
- The written `models.json` shape resolves: with `PI_CODING_AGENT_DIR` pointed
  at a tmp dir holding it, `pi --list-models` shows
  `gtd-evals  claude-4-5-haiku  200K  32K`.
- Every pi flag the spawn passes (`-p`, `--model`, `--system-prompt`,
  `--api-key`, `--no-session`, `-nc`) exists in `pi --help` for the pinned
  `0.84.4`.
- `npm test`, `npm run deadcode`, and `npm run format:check` are green;
  `evals/compare-baseline.mjs` is unchanged.
