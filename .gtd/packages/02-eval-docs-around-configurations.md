# 02 — Rewrite the eval docs around configurations

Primary path: `docs/development.md`, `## Prompt evals` section only. Prose edit
plus one flag in `evals/run-turn.mjs`.

## Requirement

PRODUCT.

`docs/development.md` must stop saying "model matrix" and "per model" and say
model **configuration** throughout — including the `npm run eval` comment line,
the two-axis versioning paragraph, and the per-fixture/per-configuration report
description.

The sketch also adds a paragraph to the "To add a case" section stating: a case
names a workflow `state`, never a model; the state's class picks which half of
the configuration runs it, so a review case and a build case in the same run are
each graded on the tier they ship against; the committed default is ONE
configuration and why; how to compare model choices for one run; and that
baseline cells key off the provider label.

The doc also claims the harness is "restricted to a four-tool surface (`read`,
`write`, `edit`, `bash`)". **That is `pi`'s default, not something this repo
pins — a `pi` version bump could widen the surface with nothing failing.**
Either pass the flag that pins it or soften the sentence to describe the
default; do not leave a guarantee the code does not make.

Two settled facts belong in this doc as well: **`npm run eval` runs every case
every time — hours, real tokens, no default subset** — and **the tier-3 judge is
pinned to a dated model id, so bumping it invalidates the baseline.** A reader
deciding whether to run the command needs the first; a reader comparing two
baselines needs the second.

Acceptance: no sentence in `docs/development.md` describes the providers as
competing models rather than one configuration.

## Tasks

### 1. Rename model matrix to model configuration throughout `## Prompt evals`

Every occurrence of "model matrix", "per model", "both models", and "against a
real model" becomes configuration language. The per-cell results **matrix** is
still a matrix and keeps that word.

Check with `grep -in "matrix\|per model\|both models" docs/development.md` — it
must come back empty except where the word describes the per-cell results
matrix.

- [ ] The `npm run eval` comment line says "under every model configuration"
- [ ] The two-axis versioning paragraph says "model configurations"
- [ ] The report description says "per fixture, per configuration"
- [ ] `grep -in "matrix\|per model\|both models" docs/development.md` returns
      only per-cell-results-matrix hits
- [ ] No sentence describes the providers as competing models

### 2. Add the configuration paragraph to the "To add a case" section

One paragraph covering all five facts: a case names a workflow `state`, never a
model; the state's class picks which half of the configuration runs it, so a
review case and a build case in the same run are each graded on the tier they
ship against; the committed default is ONE configuration and why; how to compare
model choices for one run; and that baseline cells key off the provider label.

- [ ] The paragraph states a case names a `state`, never a model
- [ ] It states the state's class picks which half of the configuration runs it
- [ ] It states the committed default is ONE configuration and gives the reason
      (every extra provider multiplies the run and adds a flakeable cell)
- [ ] It states how to compare model choices: add a second provider, run once,
      read two rows of the per-cell matrix
- [ ] It states baseline cells key off the provider label

### 3. Pin the tool surface in `pi`'s argv, or name it as a default

**Resolve the four-tool claim by pinning, not by softening.**
`evals/run-turn.mjs` already spawns `pi` with an explicit argv; add the
tool-restriction flag to that argv and the doc's sentence becomes a fact the
code states.

Softening leaves a reader guessing which tools a recorded baseline was measured
under, and the harness axis of the two-axis versioning claim then covers
nothing.

**If the installed `pi` 0.84.4 exposes no such flag, rewrite the sentence to
name the default explicitly ("`pi`'s default surface, not pinned here") — never
leave it as an unqualified guarantee.**

That one flag is the only code this package touches, and it lives in the same
argv the pin is claimed about. It moves no pass rate, so **this package does not
invalidate `evals/baseline.json`.**

- [ ] Either `evals/run-turn.mjs`'s `pi` argv carries a tool-restriction flag,
      or the doc sentence names the four-tool surface as `pi`'s default and not
      a repo pin
- [ ] The doc sentence and the code agree
- [ ] No pass rate moves and `evals/baseline.json` is untouched

### 4. State the two settled facts a reader needs

- [ ] The doc states `npm run eval` runs every case every time — hours, real
      tokens, no default subset, no case filter
- [ ] The doc states the tier-3 judge is pinned to a dated model id, so bumping
      it invalidates the baseline
