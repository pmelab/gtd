# Requirements

The human ticked every checkbox — that means "read", not sign-off — and left one
note at the top of the review. All boxes flipped without comment carry no
concern; the note is the whole round.

The note, verbatim:

> the whole evaluation process should not use claude or claude code, but use the
> the openai credentials in GTD_EVALS_URL and GTD_EVALS_KEY

Every concern below is that one instruction, split into the pieces that have to
move. No other risk from the review is in scope this lap.

## Evals run entirely against the OpenAI-compatible endpoint

PRODUCT.

**The eval harness must not touch Claude or Claude Code anywhere — not to drive
the turn, not to judge it.** Both halves currently do.

**Credentials come from exactly two environment variables the human named:
`GTD_EVALS_URL` (base URL) and `GTD_EVALS_KEY` (API key).** No other credential
source is acceptable, and `ANTHROPIC_API_KEY` stops being an input to any part
of `npm run eval`.

**This is a user-facing contract change:** the prerequisites for running the
eval are two new variables instead of `ANTHROPIC_API_KEY` plus a `claude` binary
on PATH.

## The graded turn is driven without the `claude` CLI

TECHNICAL.

**`evals/run-turn.mjs` shells out to
`claude -p --session-id --model --system-prompt --dangerously-skip-permissions`
to drive the one graded turn.** That call is the core of the harness and has to
be replaced by something that speaks to `GTD_EVALS_URL` with `GTD_EVALS_KEY`.

The replacement still has to do what the current turn does, or the eval measures
nothing: consume the prompt, system prompt, model, and session id that
`gtd next` hands it; act inside the fixture repo so `gtd land` has something to
land; and fail loudly on the 600s timeout rather than reporting an empty turn as
a result.

**The `claude` on PATH precondition in `infraFailures` goes away with it, and
the `ANTHROPIC_API_KEY` precondition is replaced by checks on the two new
variables.** Keep the property those checks exist for: an infra break must never
read as a passing grade.

## The rubric judge moves off the Anthropic API

TECHNICAL.

**`evals/promptfooconfig.yaml`'s tier-3 `llm-rubric` is pinned to
`anthropic:messages:claude-sonnet-4-5-20250929`, called directly against the
Anthropic API.** It has to be an OpenAI-compatible provider pointed at
`GTD_EVALS_URL`.

**`JUDGE_MODEL` in `evals/run-turn.mjs` duplicates that pinned id as a startup
guard so the model under test is never the judge.** Both copies move together,
or the guard silently stops guarding.

## The provider matrix and baseline cells are re-derived

TECHNICAL.

**`evals/promptfooconfig.yaml`'s two providers are `--model opus` and
`--model haiku`, injected as `GTD_PLANNERMODEL`** — Claude model names, so they
change with the endpoint. Keep the reason the matrix has two entries: one tier
the state actually runs under, one cheaper tier, so a tier trade-off is visible.

**`evals/baseline.json`'s cell keys are `provider label|variant`, so renaming a
provider label invalidates every recorded cell** — and `compareCells` fails a
cell missing from either side, by design. The committed baseline is already an
unverified 4/4 placeholder, so nothing real is lost; it must be re-recorded
against the new endpoint before anyone trusts the gate.

## Docs and the npm script state the new prerequisites

TECHNICAL.

**`package.json`'s `eval` script hard-fails on an unset `ANTHROPIC_API_KEY` with
a message naming the Anthropic API.** That guard has to name `GTD_EVALS_URL` and
`GTD_EVALS_KEY` instead.

**`docs/development.md`'s "Prompt evals" section tells a reader to set
`ANTHROPIC_API_KEY` and to put `claude` on PATH.** It is the only place a person
learns how to run this, so it has to describe the two new variables and drop
both Claude prerequisites — including the parenthetical explaining that driver
turns run through the `claude` CLI's own auth.
