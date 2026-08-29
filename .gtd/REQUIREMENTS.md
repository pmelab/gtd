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

Both product questions are answered and folded in. **The graded turn runs on the
pi coding agent (`@earendil-works/pi-coding-agent`), added as a devDependency,
and Claude-family model ids stay in the matrix** — the ban is on the `claude`
CLI and the Anthropic API, not on the models.

Build order is the order below. Concerns 1–3 are TECHNICAL; concern 4 is the
PRODUCT one and lands last, because only after 1–3 is Anthropic genuinely gone
and the new prerequisites true.

**Nothing here is on `npm test`'s path** — `npm run eval` is a deliberate human
action. Every concern leaves the suite green because the suite never runs the
eval; the only unit coverage in scope is `tests/tooling/eval-baseline.test.ts`,
which imports `evals/compare-baseline.mjs` and touches no model.

## The graded turn is driven over the OpenAI-compatible endpoint

TECHNICAL. Biggest piece; everything else waits on it.

**`evals/run-turn.mjs` shells out to
`claude -p --session-id --model --system-prompt --dangerously-skip-permissions`
to drive the one graded turn.** That call is the core of the harness and has to
be replaced by something that speaks to `GTD_EVALS_URL` with `GTD_EVALS_KEY`.

**The replacement is the pi coding agent, added as a devDependency:
`@earendil-works/pi-coding-agent`.** Nothing is hand-rolled — pi ships a `pi`
binary and gives the model `read`, `write`, `edit`, and `bash` by default, which
is the whole tool surface a spec-review turn needs.

**The `claude -p` call maps onto `pi -p` flag for flag:** `--model` stays
`--model`, `--system-prompt` stays `--system-prompt`, the prompt still arrives
on stdin (pi's print mode merges piped stdin into the initial prompt), and the
600s timeout still applies to the spawn. **`--dangerously-skip-permissions` has
no counterpart and needs none — pi has no tool-approval prompt and no sandbox.**

**Resolve the binary at `node_modules/.bin/pi`, never the bare name `pi`.**
`evals/fixture.mjs` already does exactly this for `oxfmt` via `OXFMT_BIN`; the
bare name only resolves when the process was started from an npm script, which
is the trap `evals/eval.mjs` already fell into with `promptfoo`.

**pi reaches the gateway through a `models.json` in a config directory the
harness owns.** pi has no base-URL flag: a custom OpenAI-compatible endpoint is
declared as a provider entry with `baseUrl`, `api: "openai-completions"`, and a
model list, read from `~/.pi/agent/models.json` — relocatable per run with
`PI_CODING_AGENT_DIR`. The key rides on `--api-key "$GTD_EVALS_KEY"`.

**Point `PI_CODING_AGENT_DIR` at a directory under the fixture's tmpdir, not at
the real `~/.pi`.** Otherwise the operator's own pi settings, saved logins,
installed packages, and default model leak into a graded turn and the eval stops
being reproducible. Set `PI_OFFLINE` for the same reason: pi does update checks
and package refreshes at startup, and a graded turn must not depend on them.

**Add `--no-session` (or a session dir under the fixture) and `-nc`.** Sessions
default to writing under the config dir, and `-nc` disables `AGENTS.md` /
`CLAUDE.md` context discovery — without it pi reads the fixture's own context
files and grades a prompt it was never handed.

**`scrubbedEnv` in `evals/fixture.mjs` must learn `PI_*` the way it already
knows `GTD_*`.** It strips `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
`GTD_LOOP_LOG` and every `GTD_*` var today; an ambient `PI_CODING_AGENT_DIR` or
`PI_MODEL` from the operator's shell is the same class of leak.

The replacement still has to do what the current turn does, or the eval measures
nothing: consume the prompt, system prompt, and model that `gtd next` hands it;
act inside the fixture repo so `gtd land` has something to land; and fail loudly
on the 600s timeout rather than reporting an empty turn as a result. The timeout
stays a hard failure that keeps the fixture repo for post-mortem.

**`session.id` and `session.resume` stop being read.** They are driver-side
mappings onto an agent CLI's own session flags, and a single graded turn never
resumes anything. **Cost of dropping them: this harness can only ever grade a
single-turn state.** Today's only case, `packages.item.spec.review`, is exactly
that; a future case that depends on resuming a prior turn cannot be graded until
session handling comes back. pi does have `--session <path|id>`, so that door is
open — it is just not opened here.

**The `claude`-on-`PATH` precondition in `infraFailures` goes away, and the
`ANTHROPIC_API_KEY` precondition is replaced by checks on `GTD_EVALS_URL` and
`GTD_EVALS_KEY`.** A missing `node_modules/.bin/pi` becomes its own precondition
beside the missing-bundle one. Keep the property those checks exist for: an
infra break must never read as a passing grade. That property is what makes
every other precondition in that list worth keeping — missing variant, missing
`--model`, missing bundle.

**Risk, blunt: the agent harness is now part of what the eval measures.** A
prompt that scores badly through pi and well through `claude -p` cannot be told
apart from a bad prompt. pi's tool surface, its default system prompt (replaced
here, so only context files and skills still append), and its pinned version are
grading parameters, not implementation details, and belong in the docs beside
the model matrix. **Pin `@earendil-works/pi-coding-agent` exactly, no caret**,
for the same reason `promptfoo` is pinned to `0.122.1`: a minor bump that
changes the default tool set silently moves every baseline cell.

**`.fallowrc.json` needs `@earendil-works/pi-coding-agent` in
`ignoreDependencies`,** exactly like `promptfoo` — it is spawned as a binary and
never imported, so fallow reads it as an unused dependency and
`npm run deadcode` reds.

**Second supply-chain risk, stated plainly: this is the second large dev-only
dependency tree in a row.** `promptfoo` already added roughly 1780 packages and
~20k lines of `package-lock.json`. pi brings its own tree. Nothing in `npm test`
or the published bundle depends on either, but the accept is deliberate, not a
skim.

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

**The judge may still be a Claude-family model** — it just reaches it through
`GTD_EVALS_URL` instead of `api.anthropic.com`. `claude-4-5-sonnet` on the
gateway is the closest thing to the pinned snapshot the judge uses today, which
keeps tier-3 scores roughly comparable across the swap.

**The judge must stay out of the provider matrix.** That is the whole point of
the guard, and it constrains concern 3's model picks: whichever id judges cannot
also be graded.

**Acceptance:** `grep -r anthropic evals/` returns nothing, and a run with the
judge id passed as `--model` still fails at startup.

## The provider matrix and baseline cells are re-derived

TECHNICAL.

**`evals/promptfooconfig.yaml`'s two providers are `--model opus` and
`--model haiku`, injected as `GTD_PLANNERMODEL`** — Claude CLI aliases, which
the gateway does not serve under those names. **Claude-family ids stay**, so
this is a rename to full gateway ids, not a move to a different model family:
`claude-4-5-opus` (or a newer opus the gateway lists) for `planner`, and
`claude-4-5-haiku` for `cheap`.

**Every id must be one `GET /models` on the gateway actually lists** — a
mistyped id fails as a model error mid-trial, which reads as a bad turn rather
than as an infra break. Keep the reason the matrix has two entries: one tier the
state actually runs under, one cheaper tier, so a tier trade-off is visible.

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

**No binary prerequisite replaces `claude` on `PATH`.** pi arrives with
`npm install` like every other devDependency, so the prerequisites really are
two environment variables and nothing else — that is the concrete win of
choosing a dependency over an installed CLI.

**`docs/development.md`'s "Prompt evals" section tells a reader to set
`ANTHROPIC_API_KEY` and to put `claude` on `PATH`.** It is the only place a
person learns how to run this, so it has to describe the two new variables and
drop both Claude prerequisites — including the parenthetical explaining that
driver turns run through the `claude` CLI's own auth, and the `gtd next` →
`claude -p` → `gtd land` cycle it spells out twice, which becomes `gtd next` →
`pi -p` → `gtd land`.

**The doc also has to name pi's version and tool surface as grading
parameters,** for the reason concern 1 gives: a reader comparing two baselines
needs to know the harness moved, not just the model.

**Two statements in that doc survive verbatim and must not be lost in the
rewrite:** the flakiness expectation (one bad turn is 25% of a 4-trial cell, the
eval is never a CI gate, and the fix for routine re-runs is more trials rather
than a softer threshold), and the placeholder-baseline caveat — which is deleted
rather than reworded once concern 3 records a real baseline.

**Acceptance:** `grep -rn ANTHROPIC_API_KEY .` returns nothing outside git
history, and the doc's prerequisites paragraph names both variables.

## Answered Questions

### What drives the one graded turn now that `claude -p` is gone?

The pi coding agent, `@earendil-works/pi-coding-agent`, added as a
devDependency. It ships a `pi` binary with `read`/`write`/`edit`/`bash` tools, a
`-p` print mode that takes the prompt on stdin, and `--model`/`--system-prompt`/
`--api-key` flags that map onto the `claude -p` call one for one. No new
prerequisite for a person running the eval, and nothing hand-rolled to own.

### May the models under test still be Claude-family ids served by the gateway?

Yes. The ban is on the `claude` CLI and the Anthropic API, not on the model
family, so the matrix keeps grading the tier gtd actually runs under — reached
through `GTD_EVALS_URL` like everything else.

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
