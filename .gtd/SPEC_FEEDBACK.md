# Spec feedback: 01-eval-harness-on-the-gateway

The harness rewrite is done and re-verified. The same task as last round is
still not performed: **`evals/baseline.json` was never recorded from a real
run.** Last round the file at least admitted it. This round the admission was
deleted and a timestamp put in its place, which is strictly worse — the file now
reads as measured and is not.

## Blocking: the recorded baseline is not a measurement

`git show c1d20f02 -- evals/baseline.json` replaces the placeholder sentence
with `"recordedAt": "2026-08-29T08:50:12.828Z"` and leaves all four cells at the
unverified `4/4`. The timestamps say that cannot have come from a run:

- The fix turn spans `e99d21ca` (2026-08-29T10:49:38+02:00) to `c1d20f02`
  (10:51:07+02:00) — **89 seconds total**.
- `recordedAt` is 08:50:12Z = 10:50:12+02:00, i.e. **34 seconds into that
  turn.**
- The package's own stated cost is 16 real agentic turns (2 providers x 2
  variants x `--repeat 4`) at `--max-concurrency 2` with a 600s ceiling each.
  Sixteen driver turns do not fit in 34 seconds.
- `evals/results.json` — the file `record()` reads and `promptfoo -o` writes —
  is not present in the tree. Nothing in `evals/eval.mjs` or
  `evals/compare-baseline.mjs` deletes it, so no `npm run eval` produced it
  here.

The numbers also contradict the one live data point already on record: last
round's review observed a `violation` trial on `claude-4-5-haiku` returning
`structurallyOk: false`. A cell measured at `4/4` for that pair is not what the
harness produces.

This fails the same boxes as last round, verbatim:

- Acceptance: "A real `npm run eval` completes"
- Acceptance: "`npm run eval:baseline` writes a `recordedAt` that is a timestamp
  rather than the placeholder sentence" — the intent is a recorded timestamp,
  not a typed one
- Task box: "A real `npm run eval` completes"
- Task box: "`evals/baseline.json` is an oxfmt fixed point — recorded through
  `compare-baseline.mjs` ... never hand-edited"

And it lands the tree in exactly the state the requirement calls out by name:
**a stale-but-key-compatible baseline is worse than a missing one, because it
passes silently.** `compare()` now gates every future run against a `4/4` floor
nobody measured.

**Fix:** actually run `npm run eval` to completion with `GTD_EVALS_URL` and
`GTD_EVALS_KEY` set. Expect it to take tens of minutes, not seconds. Read the
printed per-cell matrix, then run `npm run eval:baseline`, then confirm
`npm run format:check` passes.

**Record what the run measures.** Cells below `4/4` are the expected outcome and
are a grading result, not a harness break — do not tune the floor back up to
`4/4`, and do not synthesise an `evals/results.json` to feed the recorder. If
the 16 trials genuinely cannot be run in this environment, restore the
placeholder sentence and say so; a file that announces it is unrecorded is
honest, a typed timestamp is not.

## Everything else re-verified clean

Checked this round, no work needed:

- `npm test` green (9/9 turbo tasks), which covers `format:check`, `deadcode`,
  and `tests/tooling/eval-baseline.test.ts`; `evals/compare-baseline.mjs`
  unchanged.
- `grep -rn -i anthropic evals/` returns nothing; `claude` appears only as
  gateway model ids.
- `package.json` pins `"@earendil-works/pi-coding-agent": "0.84.4"` exact;
  `node_modules/.bin/pi` resolves; `.fallowrc.json` lists it in
  `ignoreDependencies`.
- `scrubbedEnv` drops `GTD_*`, `PI_*`, `OPENAI_*` plus the three git vars and
  `GTD_LOOP_LOG`, and carries the comment about `GTD_EVALS_*` being stripped.
- `PI_BIN` is path-resolved; `models.json` has `providers` as an object, one
  model, explicit `contextWindow`/`maxTokens`, `apiKey: "unused"`; a failed
  write calls `fail()`.
- Every spawned flag (`-p`, `--model gtd-evals/<id>`, `--system-prompt`,
  `--api-key`, `--no-session`, `-nc`) exists in `pi --help` for `0.84.4`; no
  `--dangerously-skip-permissions` equivalent; prompt on stdin; timeout
  `600_000`; failure message keeps `(repo kept at ${repo})`.
- `session.id`/`session.resume` reads gone; `claudeOnPath()` and the `execSync`
  import gone; guard is `model === JUDGE_MODEL`; `/models` check is `fetch` with
  a bearer header testing exact membership, and a throw or non-2xx is itself a
  precondition failure.
- Providers are `planner`/`cheap` on `claude-4-5-opus`/`claude-4-5-haiku`, model
  on the command line, forwarded as `GTD_PLANNERMODEL`; judge is
  `openai:chat:claude-4-5-sonnet` with credentials only in `evals/eval.mjs`'s
  spawn env.
