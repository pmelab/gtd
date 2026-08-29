# The eval harness runs entirely on the gateway

Everything that reaches a model goes through `GTD_EVALS_URL`; nothing names
Anthropic.

Primary paths: `evals/run-turn.mjs`, `evals/promptfooconfig.yaml`,
`evals/eval.mjs`, `evals/fixture.mjs`, `evals/baseline.json`, `package.json`,
`.fallowrc.json`.

This package covers three requirements that were merged because all three centre
on `evals/run-turn.mjs` and `evals/promptfooconfig.yaml`. Each is carried below
verbatim, so each can be reviewed against this package independently.

## Requirements

### The graded turn is driven over the OpenAI-compatible endpoint

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

### The rubric judge moves off the Anthropic API

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

### The provider matrix and baseline cells are re-derived

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

## Tasks

### Add pi as a pinned devDependency and teach the tooling about it

- [ ] `package.json` has `"@earendil-works/pi-coding-agent": "0.84.4"` under
      `devDependencies`, exact — no caret, no tilde
- [ ] `npm install` produces a `node_modules/.bin/pi` shim
- [ ] `.fallowrc.json`'s `ignoreDependencies` contains
      `"@earendil-works/pi-coding-agent"` beside `"promptfoo"`
- [ ] `npm run deadcode` passes
- [ ] The `legacy-node20` dist-tag (`0.74.2`) is NOT used — `engines` is `>=22`
      and that tag is an older, different tool surface

Paths: `package.json`, `package-lock.json`, `.fallowrc.json`.

### Scrub `PI_*` and `OPENAI_*` from the child environment

- [ ] `scrubbedEnv` in `evals/fixture.mjs` deletes every `PI_*` variable
- [ ] `scrubbedEnv` deletes every `OPENAI_*` variable
- [ ] The existing drops stay: `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`,
      `GTD_LOOP_LOG`, and every `GTD_*` var
- [ ] A comment at `scrubbedEnv` states the non-obvious consequence:
      `GTD_EVALS_URL` and `GTD_EVALS_KEY` are stripped too, because they start
      with `GTD_`, so every read of them must come from `process.env` in the
      parent

Paths: `evals/fixture.mjs`.

### Write pi's config directory and `models.json` per run

- [ ] `evals/run-turn.mjs` resolves
      `PI_BIN = join(HERE, "..", "node_modules", ".bin", "pi")` — never the bare
      name `pi`, which only resolves when started from an npm script
- [ ] The pi config directory is its own `mkdtempSync` under the OS tmpdir, a
      sibling of the fixture repo, never a directory inside it — anything pi
      writes inside the repo lands in `git diff` after `gtd land` and is graded
      as `otherFilesChanged`
- [ ] `<piDir>/models.json` is written before the spawn, with `providers` as an
      object keyed by provider name (NOT an array):
      `{"providers":{"gtd-evals":{"baseUrl":"<GTD_EVALS_URL>","api":"openai-completions","apiKey":"unused","compat":{"supportsDeveloperRole":false},"models":[{"id":"<model>","contextWindow":200000,"maxTokens":32000}]}}}`
- [ ] Only the one model under test is declared
- [ ] `contextWindow` and `maxTokens` are stated explicitly, not left to pi's
      defaults — a default smaller than the graded prompt truncates it silently
      and grades a prompt the state never wrote
- [ ] `apiKey` in the file is the placeholder `"unused"`; the real key rides on
      `--api-key`, because a `"$GTD_EVALS_KEY"` interpolation cannot work
      against a scrubbed environment
- [ ] `baseUrl` and the key are read from `process.env` in the parent, before
      scrubbing
- [ ] A failed `models.json` write fails the trial rather than letting pi fall
      back to a built-in provider and grade a model nobody chose

Paths: `evals/run-turn.mjs`.

### Replace the `claude -p` spawn with `pi -p`

- [ ] `execFileSync(PI_BIN, [...], { cwd: repo, env, input: prompt, encoding: "utf-8", timeout: TURN_TIMEOUT_MS })`
- [ ] `TURN_TIMEOUT_MS` is unchanged at `600_000`
- [ ] The child env adds `PI_CODING_AGENT_DIR=<piDir>` and `PI_OFFLINE=1`, for
      the pi spawn only
- [ ] Flags are `-p`, `--model gtd-evals/<turnModel>`,
      `--system-prompt <system>`, `--api-key <GTD_EVALS_KEY>`, `--no-session`,
      `-nc`
- [ ] `--model` is provider-qualified as `gtd-evals/<id>`, never the bare id —
      `--model` takes a pattern and a bare id can match a built-in catalog entry
- [ ] `-nc` is present, without which pi reads the fixture's own `AGENTS.md` /
      `CLAUDE.md` and grades a prompt it was never handed
- [ ] No `--dangerously-skip-permissions` equivalent is passed — pi has no
      tool-approval prompt and no sandbox
- [ ] The prompt still arrives on stdin
- [ ] `gtd next --json=kind`, `=model`, `=system` and `=validate` are still
      read, and the validate-must-be-empty check stays
- [ ] The `session.id` and `session.resume` reads are deleted
- [ ] A spawn failure or a 600s timeout stays a hard failure that keeps the
      fixture repo, with the message shape `... (repo kept at ${repo})`

Paths: `evals/run-turn.mjs`.

### Move the judge onto the gateway

- [ ] `evals/promptfooconfig.yaml`'s tier-3 `llm-rubric` provider is
      `openai:chat:claude-4-5-sonnet`
- [ ] The YAML holds no credentials
- [ ] `evals/eval.mjs`'s `spawn` env is
      `{ ...process.env, OPENAI_BASE_URL: process.env.GTD_EVALS_URL, OPENAI_API_KEY: process.env.GTD_EVALS_KEY }`
- [ ] This is the only place in `evals/` that reads or sets `OPENAI_*`
- [ ] `JUDGE_MODEL` in `evals/run-turn.mjs` is the plain string
      `"claude-4-5-sonnet"`, still duplicated rather than imported
- [ ] The guard is exact equality, `model === JUDGE_MODEL`, replacing
      `JUDGE_MODEL.includes(model)`
- [ ] `claude-4-5-sonnet` never appears in the provider matrix

Paths: `evals/promptfooconfig.yaml`, `evals/eval.mjs`, `evals/run-turn.mjs`.

### Rewrite the startup preconditions

- [ ] `claudeOnPath()` is deleted, and the now-unused `execSync` import with it
      — leaving the import reds oxlint
- [ ] `infraFailures` keeps: unknown or missing variant, missing `--model`,
      missing bundle at `GTD_BIN`
- [ ] `model === JUDGE_MODEL` replaces the substring test
- [ ] Missing `PI_BIN` is its own precondition, naming `npm install`
- [ ] Unset `GTD_EVALS_URL` is its own precondition
- [ ] Unset `GTD_EVALS_KEY` is its own precondition
- [ ] A `GET $GTD_EVALS_URL/models` check fails with "model X is not served by
      GTD_EVALS_URL" when the bare id is absent from `data[].id`
- [ ] That check uses `fetch` (built in on Node 22+, and `engines` is `>=22`)
      with an `Authorization: Bearer <GTD_EVALS_KEY>` header, and tests exact
      membership of the bare id
- [ ] `infraFailures` and `checkInfra` become `async`; `main` already awaits and
      no other caller exists
- [ ] A `/models` request that throws or returns non-2xx is itself a
      precondition failure, never a skipped check — treating an unreachable
      gateway as "id is probably fine" sends the run into 16 doomed turns
- [ ] Every precondition calls the existing `fail()`: stderr, `process.exit(1)`
- [ ] The `err.status === 1` narrowing stays scoped to `unformattedGtdFiles`; no
      new call site copies it

Paths: `evals/run-turn.mjs`.

Accepted cost: one extra network call on every one of the 16 trials, and startup
now depends on the network.

### Re-derive the provider matrix

- [ ] `evals/promptfooconfig.yaml`'s providers are
      `exec:node run-turn.mjs --model claude-4-5-opus` labelled `planner` and
      `exec:node run-turn.mjs --model claude-4-5-haiku` labelled `cheap`
- [ ] The labels `planner` and `cheap` are unchanged, keeping the
      `provider label|variant` cell keys `planner|clean`, `planner|violation`,
      `cheap|clean`, `cheap|violation` valid
- [ ] The model still rides on the provider's own command line as `--model`,
      never a promptfoo `--var` an ambient env var could outrank
- [ ] `run-turn.mjs` still forwards it as `GTD_PLANNERMODEL` through
      `scrubbedEnv`'s overrides
- [ ] Both ids appear in `GET /models` on the gateway

Paths: `evals/promptfooconfig.yaml`.

Accepted cost: the planner cell measures `claude-4-5-opus`, not
`claude-4-8-opus` — the newest opus the gateway lists — so a person pointing
`plannerModel: smart` at a newer opus reads a floor recorded one generation
down. The pick keeps the matrix on one generation across three tiers, and keeps
the judge from being a generation behind what it grades.

### Re-record the baseline against the new endpoint

- [ ] A real `npm run eval` completes
- [ ] `npm run eval:baseline` is run after reading the printed matrix
- [ ] `evals/baseline.json`'s `recordedAt` is an ISO timestamp, not the
      placeholder sentence
- [ ] `evals/baseline.json` is an oxfmt fixed point — recorded through
      `compare-baseline.mjs`, which already runs `OXFMT_BIN` on write, never
      hand-edited
- [ ] `npm run format:check` passes

Paths: `evals/baseline.json`.

Cost: 16 real agentic turns — 2 providers x 2 variants x `--repeat 4` — each
with a 600s ceiling, at `--max-concurrency 2`.

### Confirm nothing on the test path moved

- [ ] No cucumber scenario and no unit test is added — nothing here is reachable
      from `npm test`, and `npm run eval` is a deliberate human action
- [ ] `evals/compare-baseline.mjs` is unchanged, so
      `tests/tooling/eval-baseline.test.ts` still passes untouched
- [ ] `npm test` is green

Paths: none changed.

## Risks

**The agent harness is now part of what the eval measures.** A prompt that
scores badly through pi and well through `claude -p` cannot be told apart from a
bad prompt. pi's tool surface, its replaced default system prompt, and its
pinned version are grading parameters, not implementation details.

**Second large dev-only dependency tree in a row.** `promptfoo` already added
roughly 1780 packages and ~20k lines of `package-lock.json`; pi brings its own.
Nothing in `npm test` or the published bundle depends on either, but the accept
is deliberate, not a skim.

**Dropping `session.id`/`session.resume` costs the ability to grade anything but
a single-turn state.** Today's only case, `packages.item.spec.review`, is
exactly that. pi does have `--session <path|id>`, so the door is open — it is
just not opened here.

**`compat.supportsDeveloperRole: false` is a safe default, not a measured one.**
If the first real run shows the gateway accepts the `developer` role, drop the
flag.

## Acceptance

- [ ] With `ANTHROPIC_API_KEY` unset and no `claude` on `PATH`, one trial runs
      end to end and prints its JSON line
- [ ] `evals/run-turn.mjs` names neither `claude` nor `ANTHROPIC_API_KEY`
- [ ] `grep -r anthropic evals/` returns nothing
- [ ] A run with `claude-4-5-sonnet` passed as `--model` fails at startup
- [ ] A run with a model id the gateway does not list fails at startup, naming
      the id
- [ ] A real `npm run eval` completes
- [ ] `npm run eval:baseline` writes a `recordedAt` that is a timestamp rather
      than the placeholder sentence, and the committed file is an oxfmt fixed
      point
