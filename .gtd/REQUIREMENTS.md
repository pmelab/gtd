# Requirements

The human ticked every checkbox — that means "read", not sign-off — and left one
note at the top of the review. All boxes flipped without comment carry no
concern; the note is the whole round.

The note, verbatim:

> the whole evaluation process should not use claude or claude code, but use the
> the openai credentials in GTD_EVALS_URL and GTD_EVALS_KEY

Every concern below is that one instruction, split into the pieces that have to
move. No other risk from the review is in scope this lap. `npm test` is green at
the start of this lap, so no repair concern comes first.

This lap merges the round's opening contract concern with its closing docs
concern: both are the same user-facing prerequisite change, and neither is worth
building alone. The other three concerns are unchanged in identity and developed
below with what the endpoint actually turned out to serve.

Build order is the order below. Concerns 1–3 are TECHNICAL; concern 4 is the
PRODUCT one and lands last, because only after 1–3 is Anthropic genuinely gone
and the new prerequisites true.

**Nothing here is on `npm test`'s path** — `npm run eval` is a deliberate human
action. Every concern leaves the suite green because the suite never runs the
eval; the only unit coverage in scope is `tests/tooling/eval-baseline.test.ts`,
which imports `evals/compare-baseline.mjs` and touches no model.

## Open Questions

### What drives the one graded turn now that `claude -p` is gone?

The turn must READ the fixture repo and WRITE `.gtd/SPEC_FEEDBACK.md` into it —
a plain chat completion cannot, so something agentic has to sit between the
prompt and the file system. Verified this lap: the endpoint serves
`/chat/completions` with OpenAI function-calling, and returns a well-formed
`tool_calls` response, so a hand-rolled loop is viable.

- [ ] A self-contained agent loop inside `evals/` — chat-completions plus a
      small tool set (read file, write file, run command), no new binary, no new
      prerequisite for a person running the eval
- [ ] An existing third-party agent CLI on `PATH` (one that honours
      `OPENAI_BASE_URL`/`OPENAI_API_KEY`) — less code to own, but trades the
      `claude`-on-`PATH` prerequisite for a different binary prerequisite
- [ ] _your answer_

### May the models under test still be Claude-family ids served by the gateway?

The endpoint serves both Claude-family ids (`claude-4-8-opus`,
`claude-4-5-opus`, `claude-4-5-sonnet`, `claude-4-5-haiku`) and non-Claude ones
(`gpt-5.5`, `gemini-3.5-flash`, `deepseek-v3.2`, `kimi-k2.5`, …). The note bans
"claude or claude code" without saying whether it bans the vendor path or the
model family. This decides what the eval measures and what every baseline cell
means.

- [ ] Claude-family ids are fine — the ban is on the `claude` CLI and the
      Anthropic API, not on the models; the eval keeps grading the tier gtd
      actually runs under
- [ ] No Claude-family ids anywhere — the matrix and the judge move to
      non-Claude models on the same endpoint, and the eval stops reflecting the
      tier gtd is usually driven with
- [ ] _your answer_

## The graded turn is driven over the OpenAI-compatible endpoint

TECHNICAL. Biggest piece; everything else waits on it.

**`evals/run-turn.mjs` shells out to
`claude -p --session-id --model --system-prompt --dangerously-skip-permissions`
to drive the one graded turn.** That call is the core of the harness and has to
be replaced by something that speaks to `GTD_EVALS_URL` with `GTD_EVALS_KEY`.

The replacement still has to do what the current turn does, or the eval measures
nothing: consume the prompt, system prompt, and model that `gtd next` hands it;
act inside the fixture repo so `gtd land` has something to land; and fail loudly
on the 600s timeout rather than reporting an empty turn as a result. The timeout
stays a hard failure that keeps the fixture repo for post-mortem.

**`session.id` and `session.resume` stop being read.** They are driver-side
mappings onto an agent CLI's own session flags, and there is no session store on
the far side of a chat-completions call. **Cost of dropping them: this harness
can only ever grade a single-turn state.** Today's only case,
`packages.item.spec.review`, is exactly that; a future case that depends on
resuming a prior turn cannot be graded until session handling comes back.

**The `claude`-on-`PATH` precondition in `infraFailures` goes away, and the
`ANTHROPIC_API_KEY` precondition is replaced by checks on `GTD_EVALS_URL` and
`GTD_EVALS_KEY`.** Keep the property those checks exist for: an infra break must
never read as a passing grade. That property is what makes every other
precondition in that list worth keeping — missing variant, missing `--model`,
missing bundle.

**Risk, blunt: a hand-rolled agent loop becomes part of what the eval
measures.** A prompt that scores badly through a thin loop and well through
`claude -p` cannot be told apart from a bad prompt. Whatever the answer to the
first open question, the loop's tool surface and turn cap are grading
parameters, not implementation details, and belong in the docs alongside the
model matrix.

**Acceptance:** with `ANTHROPIC_API_KEY` unset and no `claude` on `PATH`, one
trial runs end to end and prints its JSON line, and `evals/run-turn.mjs` names
neither `claude` nor `ANTHROPIC_API_KEY`.

## The rubric judge moves off the Anthropic API

TECHNICAL.

**`evals/promptfooconfig.yaml`'s tier-3 `llm-rubric` is pinned to
`anthropic:messages:claude-sonnet-4-5-20250929`, called directly against the
Anthropic API.** It has to be an OpenAI-compatible provider pointed at
`GTD_EVALS_URL`.

**`JUDGE_MODEL` in `evals/run-turn.mjs` duplicates that pinned id as a startup
guard so the model under test is never the judge.** Both copies move together,
or the guard silently stops guarding.

**That guard is `JUDGE_MODEL.includes(model)`, a loose substring test.** It both
over-matches and under-matches today, and the new id space makes it worse: with
bare gateway ids, a model named `claude-4-5-opus` is a substring of nothing, but
short ids collide easily. **The guard becomes an exact-equality check against
the judge id** — the substring form buys nothing once both sides are plain
gateway model ids.

**Acceptance:** `grep -r anthropic evals/` returns nothing, and a run with the
judge id passed as `--model` still fails at startup.

## The provider matrix and baseline cells are re-derived

TECHNICAL. Depends on the answer to the second open question.

**`evals/promptfooconfig.yaml`'s two providers are `--model opus` and
`--model haiku`, injected as `GTD_PLANNERMODEL`** — Claude CLI aliases, which
the gateway does not serve under those names. Keep the reason the matrix has two
entries: one tier the state actually runs under, one cheaper tier, so a tier
trade-off is visible.

**The injection route does not change:** the model rides on the provider's own
command line as `--model`, deliberately not a promptfoo `--var` that an ambient
env var could outrank.

**`evals/baseline.json`'s cell keys are `provider label|variant`, so renaming a
provider label invalidates every recorded cell** — and `compareCells` fails a
cell missing from either side, by design. The committed baseline is already an
unverified 4/4 placeholder, so nothing real is lost; **it must be re-recorded
against the new endpoint before anyone trusts the gate.**

**Keeping the labels `planner` and `cheap` keeps the existing cell keys valid
and is the cheaper path** — but a stale-but-key-compatible baseline is worse
than a missing one, because it passes silently. Either way the placeholder is
re-recorded in this concern, not left for later.

**Acceptance:** a real `npm run eval` completes, `npm run eval:baseline` writes
a `recordedAt` that is a timestamp rather than the placeholder sentence, and the
committed file is an oxfmt fixed point.

## Running the eval needs only `GTD_EVALS_URL` and `GTD_EVALS_KEY`

PRODUCT. Lands last — it states as fact what concerns 1–3 make true.

**Credentials come from exactly two environment variables the human named:
`GTD_EVALS_URL` (base URL) and `GTD_EVALS_KEY` (API key).** No other credential
source is acceptable, and `ANTHROPIC_API_KEY` stops being an input to any part
of `npm run eval`.

**`package.json`'s `eval` script hard-fails on an unset `ANTHROPIC_API_KEY` with
a message naming the Anthropic API.** That guard has to name both new variables
instead, and keep the same shape: fail before `npx turbo run build`, with a
message that says which variable is missing.

**`docs/development.md`'s "Prompt evals" section tells a reader to set
`ANTHROPIC_API_KEY` and to put `claude` on `PATH`.** It is the only place a
person learns how to run this, so it has to describe the two new variables and
drop both Claude prerequisites — including the parenthetical explaining that
driver turns run through the `claude` CLI's own auth, and the `gtd next` →
`claude -p` → `gtd land` cycle it spells out twice.

**Two statements in that doc survive verbatim and must not be lost in the
rewrite:** the flakiness expectation (one bad turn is 25% of a 4-trial cell, the
eval is never a CI gate, and the fix for routine re-runs is more trials rather
than a softer threshold), and the placeholder-baseline caveat — which is deleted
rather than reworded once concern 3 records a real baseline.

**Acceptance:** `grep -rn ANTHROPIC_API_KEY .` returns nothing outside git
history, and the doc's prerequisites paragraph names both variables.

## Answered Questions

### Does the endpoint support the tool calling an agentic turn needs?

Yes — verified this lap against the live endpoint. `POST /chat/completions` with
a `tools` array returned `finish_reason: "tool_calls"` and a well-formed call on
`claude-4-5-haiku`, so the graded turn can edit files through function calls
rather than needing a vendor CLI.

### How does promptfoo's judge reach a non-OpenAI base URL?

Through the stock `openai:chat:<model>` provider: promptfoo's OpenAI provider
honours a `config.apiBaseUrl` and a `config.apiKeyEnvar`, and falls back to
`OPENAI_BASE_URL`. `evals/eval.mjs` maps `GTD_EVALS_URL`/`GTD_EVALS_KEY` onto
those, so the YAML stays free of credentials and no custom provider is needed.

### Is a new baseline recorded in this change or left to a follow-up?

Recorded in this change, under concern 3. The gate already ships known-wrong;
carrying a placeholder across an endpoint swap turns a loud first failure into a
silent stale pass.

### Does the fixture builder change?

No. `evals/fixture.mjs`, `evals/cases/spec-review.mjs`, and
`evals/asserts/spec-review.mjs` are model-agnostic — they build a repo, plant a
defect, and grade files that changed. Only the thing that drives the turn and
the thing that judges its prose touch a model.
