# The eval baseline and its regression gate

## Requirement — The baseline and its regression gate (PRODUCT)

A committed `baseline.json` records the pass rates a green run produced. The
eval gates against it with promptfoo's `--compare --fail-on-regression`.

**The baseline is updated deliberately, exactly like a test snapshot** — a human
records a new one and commits it as its own reviewable change. It is never
refreshed automatically by a passing run, or the gate grades nothing.

**Any drop in a fixture's pass rate fails the run — no noise tolerance.** 4/4 to
3/4 reds it, for one model on one fixture.

**Risk — one flaky turn reds the gate.** With 4 trials a single
non-deterministic agent turn is a whole 25% of a fixture's rate, so a healthy
prompt will sometimes fail. Accepted: the eval is a deliberate human action,
never a CI gate, so a human re-runs and judges. If re-runs become routine the
fix is more trials, never a softer threshold.

## Settled fact that changes the mechanism, not the intent

**Verified against the promptfoo CLI reference: `--compare` and
`--fail-on-regression` do not exist.** `promptfoo eval` supports `--repeat`,
`--config` and `-o/--output` and nothing comparative. The intent — committed
baseline, strict regression gate, deliberate updates — is unchanged; the
mechanism is a small reader (~60 lines) over the JSON output the eval run
already writes to `evals/results.json`.

## Paths

    evals/baseline.json          committed; the recorded pass rates
    evals/compare-baseline.mjs   read results.json, diff, exit 0/1; --record writes
    package.json                 `eval:baseline` script
    .gitignore                   `evals/results.json` stays ignored
    docs/development.md          the baseline-update ritual

## Tasks

### 1. The baseline file format — `evals/baseline.json`

- [ ] Shaped:

          {
                    "recordedAt": "<date>",
                    "trials": 4,
                    "rates": {
                      "planner|violation": { "passed": 4, "total": 4 },
                      "planner|clean":     { "passed": 4, "total": 4 },
                      "cheap|violation":   { "passed": 3, "total": 4 },
                      "cheap|clean":       { "passed": 4, "total": 4 }
                    }
                  }

- [ ] Keyed `<provider label>|<variant>`, flat and per-cell. The format itself
      makes an averaged number unrepresentable — no aggregate field exists
- [ ] Committed to the repository; `evals/results.json` stays gitignored

### 2. The comparison reader — `evals/compare-baseline.mjs`

- [ ] Reads `evals/results.json`, counts passed and total trials per
      `(provider label, variant)` cell, and compares each against
      `evals/baseline.json`
- [ ] Comparison is on the RATE (`passed / total`), so a run with a different
      `--repeat` still compares meaningfully
- [ ] Any cell whose rate is **lower** than the baseline's exits 1, naming the
      cell and both rates. **4/4 to 3/4 reds it, for one model on one fixture.**
      No tolerance band
- [ ] A cell present in the run but absent from the baseline exits 1 — an
      unrecorded cell is not a pass
- [ ] A cell present in the baseline but absent from the run exits 1 — a
      silently dropped fixture must not read green
- [ ] A higher rate is not a failure and does **not** rewrite the file
- [ ] Prints the per-cell counts and never a total spanning fixtures or models

### 3. The update ritual

- [ ] `npm run eval:baseline` runs `node evals/compare-baseline.mjs --record`:
      reads the last `evals/results.json`, overwrites `evals/baseline.json`,
      then runs `npx oxfmt --write evals/baseline.json` so the committed file is
      a fixed point and `format:check` stays green
- [ ] It is a separate command a human types. A passing `npm run eval` never
      calls it — a gate that refreshes its own baseline grades nothing
- [ ] `npm run eval` invokes the reader after the promptfoo run, so a regression
      exits the whole command non-zero
- [ ] `docs/development.md` documents the ritual: run the eval, read the matrix,
      record a new baseline deliberately, commit it as its own reviewable change

## Acceptance

- [ ] Pointing the run at a baseline recording 4/4 where this run scored 3/4
      exits non-zero and names the cell and both rates
- [ ] Pointing it at a matching baseline exits clean
- [ ] A run scoring HIGHER than the baseline exits clean and leaves
      `evals/baseline.json` byte-identical
- [ ] `npm run eval:baseline` rewrites the baseline and the result is an oxfmt
      fixed point, so `format:check` stays green

## Risk

**One flaky turn reds the gate.** With 4 trials a single non-deterministic agent
turn is 25% of a cell's rate, so a healthy prompt will sometimes fail. Accepted:
the eval is a deliberate human action, never a CI gate, so a human re-runs and
judges. If re-runs become routine the fix is more trials, never a softer
threshold.
