# Spec feedback — 01-eval-suite

Everything else in the package checks out. I built both fixture variants from
`evals/fixture.mjs`, drove the land step by hand (no model call), and confirmed
tier 1 reports `[".gtd/SPEC_FEEDBACK.md"]` on `violation` and `[]` on `clean`,
`unformatted` empty on both, the pre-commit hook converging `.gtd/` files, the
`prompt` rest with an empty `validate`, `GTD_PLANNERMODEL` winning over the
state's declared `plannerModel`, `GTD_EVAL_WORKFLOW` swapping in a scratch
workflow, `exec:` resolving `run-turn.mjs` against promptfoo's
`basePath: "evals"` from the repo root, `evals/report.mjs` producing per-cell
`n/total` from a real `results.json`, and `oxlint`/`fallow`/`oxfmt` all covering
`evals/` green. Two things are wrong.

## 1. `--repeat` cannot be overridden for one run without editing a committed file

Task 7 asks for `--repeat 4` to live in the `eval` script "so a human can
override it for one run without editing a committed file". It is hardcoded in
`PROMPTFOO_ARGS` in `evals/eval.mjs:18-29`, and `evals/eval.mjs` **ignores
`process.argv` entirely** — nothing is forwarded to the `promptfoo` child.

`npm run eval -- --repeat 1` therefore appends `--repeat 1` to
`node evals/eval.mjs`, where it is discarded, and the run still costs the full
16 driver turns. The only way to run fewer trials today is to edit
`evals/eval.mjs`, a committed file — exactly what the task rules out.

Fix: forward `process.argv.slice(2)` to the child **after** the defaults, so a
user-supplied `--repeat`/`--max-concurrency` wins on last-flag-wins, or gate the
default on the flag not already being present.

## 2. `evals/eval.mjs`'s line filter silently drops promptfoo's last line when it has no trailing newline

`makeLineFilter` (`evals/eval.mjs:31-40`) keeps the trailing partial line in
`buffered` and there is no `end`/`close` flush of that remainder —
`child.stdout` only has a `data` handler (`evals/eval.mjs:64`). Any final chunk
promptfoo emits without a terminating `\n` is **never written to stdout**.

Consequence: real output loss, not cosmetics. A trailing infra message or the
last table row can vanish from `npm run eval` and no other channel replaces it.

Fix: flush `buffered` (when non-empty) from a `child.stdout.on("end", ...)`
handler, respecting the current suppression state.
