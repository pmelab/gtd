# Architecture

## Open Questions

### Which opus id does the `planner` provider grade?

- [x] `claude-4-5-opus` — same generation as the `claude-4-5-haiku` cheap tier
      and the `claude-4-5-sonnet` judge, so the matrix compares one generation
      across three tiers and the judge is never a generation behind what it
      grades
- [ ] `claude-4-8-opus` — the newest opus the gateway lists, so the planner cell
      measures the tier a person would actually point `plannerModel: smart` at
      today
- [ ] _your answer_

### Does `evals/run-turn.mjs` verify the model id against `GET /models` before spawning?

- [x] Yes — one `GET $GTD_EVALS_URL/models` in `infraFailures`, failing with
      "model X is not served by GTD_EVALS_URL" when the id is absent; a typo
      becomes a loud infra break instead of a 0/4 cell that reads as a bad
      prompt, at the cost of one extra network call and a new network dependency
      in startup on every one of the 16 trials
- [ ] No — the two ids live in `evals/promptfooconfig.yaml` and are caught by
      review; the harness stays network-free until the turn itself, and a wrong
      id shows up as an identical failure in all four trials of one cell, which
      a human reading the matrix can tell from a flaky prompt
- [ ] _your answer_

## Merged Concerns

Concerns 1, 2 and 3 merge into one package. **All three center on the same two
files — `evals/run-turn.mjs` and `evals/promptfooconfig.yaml` — and none of them
merely consumes an interface an earlier one creates.** Concern 1's own
acceptance ("`evals/run-turn.mjs` names neither `claude` nor
`ANTHROPIC_API_KEY`") is unreachable until concern 2 rewrites `JUDGE_MODEL`,
which is an `anthropic:` id sitting in that same file. Concern 2's judge id and
concern 3's matrix ids are bound by the same startup guard: whichever id judges
cannot also be graded. Splitting them ships two states where the eval cannot run
at all.

Concern 4 stays its own package. It touches `package.json`'s `eval` script and
`docs/development.md`, and every sentence it writes is a statement about
behaviour the merged package creates — a pure consumer, which is the exception
that keeps a real build-on-top sequence intact.

The three merged requirements, carried verbatim so the per-package spec review
still covers each independently:

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

## The eval harness runs entirely on the gateway

Merged concerns 1, 2 and 3. Everything that reaches a model goes through
`GTD_EVALS_URL`; nothing names Anthropic.

### Dependency and tooling wiring

**`package.json` gains `"@earendil-works/pi-coding-agent": "0.84.4"` as an exact
devDependency — no caret, no tilde.** `bin` is `{ "pi": "dist/bundle/cli.js" }`,
so `npm install` puts a `node_modules/.bin/pi` shim in place and no person
installs anything by hand. The pin is a grading parameter: a minor bump that
changes pi's default tool set silently moves every baseline cell, exactly the
reason `promptfoo` is pinned to `0.122.1`.

**`.fallowrc.json`'s `ignoreDependencies` gains
`"@earendil-works/pi-coding-agent"` beside `"promptfoo"`.** pi is spawned as a
binary and never imported, so without the entry `npm run deadcode` reds on an
unused dependency.

**Node floor is already satisfied:** `engines` is `>=22`, and `0.84.4` is the
`latest` tag. The `legacy-node20` tag (`0.74.2`) is not needed and must not be
used — it is a different, older tool surface.

### Where the pi binary and its config live

**Resolve the binary as
`PI_BIN = join(HERE, "..", "node_modules", ".bin", "pi")` in
`evals/run-turn.mjs`, never the bare name `pi`.** This mirrors `OXFMT_BIN` in
`evals/fixture.mjs` exactly. The bare name only resolves when the process was
started from an npm script, and `run-turn.mjs` is spawned by promptfoo's `exec:`
provider — the trap `evals/eval.mjs` already fell into with `promptfoo`.

**The pi config directory is a second `mkdtempSync` under the OS tmpdir, a
sibling of the fixture repo, never a directory inside it.** Anything pi writes
inside the repo would show up in `git diff` after `gtd land` and be graded as
`otherFilesChanged`, turning a correct turn into a failed cell. `PI_OFFLINE=1`
and `PI_CODING_AGENT_DIR=<that dir>` go into the child env for the pi spawn
only.

**`run-turn.mjs` writes `<piDir>/models.json` before spawning.** Verified
against pi 0.84.4's own `docs/models.md`: `providers` is an **object keyed by
provider name, not an array**.

```json
{
  "providers": {
    "gtd-evals": {
      "baseUrl": "<GTD_EVALS_URL>",
      "api": "openai-completions",
      "apiKey": "unused",
      "compat": { "supportsDeveloperRole": false },
      "models": [
        { "id": "<model>", "contextWindow": 200000, "maxTokens": 32000 }
      ]
    }
  }
}
```

**Only the one model under test is declared,** written per run — the file is
disposable, and a list of every gateway id is a second place to keep in sync
with `promptfooconfig.yaml`.

**`contextWindow` and `maxTokens` are declared explicitly rather than left to
pi's defaults.** A default smaller than the graded prompt truncates it silently
and grades a prompt the state never wrote. `GET /models` reports no token limits
for the `claude-*` ids on this gateway, so these are stated, not derived.

**`compat.supportsDeveloperRole: false` sends the system prompt as a `system`
message.** The gateway is an OpenAI-compatible proxy in front of Claude models;
the `developer` role is the documented incompatibility for exactly that shape.
If the first real run shows the gateway does accept it, drop the flag — it is a
safe default, not a measured one.

**`apiKey` in the file is the placeholder `"unused"` and the real key rides on
`--api-key "$GTD_EVALS_KEY"`.** pi requires an `apiKey` present before a model
appears at all, and a `"$GTD_EVALS_KEY"` interpolation in the file cannot work:
see the scrubbing rule below.

### The spawn that replaces `claude -p`

**`execFileSync(PI_BIN, [...], { cwd: repo, env, input: prompt, encoding: "utf-8", timeout: TURN_TIMEOUT_MS })`,
with `TURN_TIMEOUT_MS` unchanged at 600_000.** Flags, each verified against pi
0.84.4's `docs/usage.md`:

- `-p` — print mode, and print mode merges piped stdin into the initial prompt,
  so the prompt still arrives on stdin
- `--model gtd-evals/<turnModel>` — **provider-qualified, not the bare id.**
  `--model` takes a _pattern_, and a bare `claude-4-5-opus` could match a
  built-in catalog entry instead of our provider; `provider/id` is pi's own
  documented disambiguation
- `--system-prompt <system>` — replaces the default prompt; context files and
  skills are still appended, which is why the next two flags exist
- `--api-key "$GTD_EVALS_KEY"` — overrides environment variables
- `--no-session` — ephemeral, nothing written under the config dir
- `-nc` — disables `AGENTS.md` / `CLAUDE.md` discovery, without which pi reads
  the fixture's own context files and grades a prompt it was never handed

**`--dangerously-skip-permissions` has no counterpart and needs none.** pi has
no tool-approval prompt and no sandbox. Print mode additionally shows no trust
prompt and, with `defaultProjectTrust` at its `ask` default and an empty config
dir, loads no project skills — so the tool surface really is pi's four defaults:
`read`, `write`, `edit`, `bash`.

**`session.id` and `session.resume` stop being read; the three `gtd next --json`
calls that fetch them go away.** `kind`, `model`, `system` and `validate` stay,
and the `validate` must-be-empty check stays.

### Env scrubbing

**`scrubbedEnv` in `evals/fixture.mjs` drops every `PI_*` and every `OPENAI_*`
variable, alongside the `GTD_*`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`
and `GTD_LOOP_LOG` it already drops.** An ambient `PI_CODING_AGENT_DIR` or
`PI_MODEL` from the operator's shell is the same class of leak as an ambient
`GTD_*`. `OPENAI_*` joins the list because `evals/eval.mjs` now sets
`OPENAI_BASE_URL` and `OPENAI_API_KEY` for promptfoo's judge, and promptfoo
spawns `run-turn.mjs` — without the drop, those reach pi and can outrank the
provider the harness just declared.

**Non-obvious consequence, and the one a builder will get wrong: `scrubbedEnv`
strips `GTD_EVALS_URL` and `GTD_EVALS_KEY` too, because they start with
`GTD_`.** Every read of them must come from `process.env` in the parent, before
scrubbing — the precondition checks, the `baseUrl` written into `models.json`,
and the `--api-key` argument. None of the three may expect the variable to
survive into the child. This constraint gets a comment at `scrubbedEnv`, since
it is the kind of invariant that lives nowhere else.

### The judge

**`evals/promptfooconfig.yaml`'s tier-3 `llm-rubric` provider becomes
`openai:chat:claude-4-5-sonnet`.** promptfoo's stock OpenAI provider honours
`OPENAI_BASE_URL` and `OPENAI_API_KEY`, so the YAML holds a model id and no
credentials.

**`evals/eval.mjs` maps the two variables onto them in the `spawn` call's env:
`{ ...process.env, OPENAI_BASE_URL: process.env.GTD_EVALS_URL, OPENAI_API_KEY: process.env.GTD_EVALS_KEY }`.**
This is the only place the mapping happens; nothing else in `evals/` reads
`OPENAI_*`.

**`JUDGE_MODEL` in `evals/run-turn.mjs` becomes the plain string
`"claude-4-5-sonnet"`, still duplicated rather than imported from the YAML, and
the guard becomes exact equality: `model === JUDGE_MODEL`.** The old
`JUDGE_MODEL.includes(model)` substring test both over- and under-matches; once
both sides are plain gateway ids it buys nothing. The two copies move together
or the guard silently stops guarding.

**`claude-4-5-sonnet` is the closest thing on the gateway to the pinned
`claude-sonnet-4-5-20250929` snapshot the judge uses today,** which keeps tier-3
scores roughly comparable across the swap. It stays out of the provider matrix —
that is what the guard is for, and it constrains the matrix ids below.

### Preconditions

`infraFailures` is rewritten. **`claudeOnPath()` and its `execSync` import are
deleted — the import becomes unused and reds oxlint if left.** The list becomes:

- unknown or missing variant (unchanged)
- missing `--model` (unchanged)
- `model === JUDGE_MODEL` (exact equality, replacing the substring test)
- missing bundle at `GTD_BIN` (unchanged)
- **missing `PI_BIN`** — "run `npm install` first", the pi-shaped sibling of the
  missing-bundle check
- **unset `GTD_EVALS_URL`**
- **unset `GTD_EVALS_KEY`**
- optionally, the `GET /models` check — see the open question

**The property these exist for is unchanged and is the reason to keep every one
of them: an infra break must never read as a passing grade.**

### Error handling

**Every precondition and every failure below calls the existing `fail()` — print
to stderr, `process.exit(1)`.** No new error path swallows anything.

- **pi spawn failure or 600s timeout stays a hard failure that keeps the fixture
  repo,** message unchanged in shape: the error plus `(repo kept at ${repo})`.
  Reporting an empty turn as a result is the failure mode this exists to
  prevent.
- **A failed `models.json` write fails the trial** rather than letting pi fall
  back to a built-in provider and grade against a model nobody chose.
- **The `err.status === 1` narrowing stays scoped to `unformattedGtdFiles`.** It
  is oxfmt's "found differences" contract, not a general pattern; no new call
  site copies it.

### The provider matrix

**`evals/promptfooconfig.yaml`'s two providers become full gateway ids, keeping
the labels `planner` and `cheap`:**

```yaml
providers:
  - id: "exec:node run-turn.mjs --model <opus id — see open question>"
    label: planner
  - id: "exec:node run-turn.mjs --model claude-4-5-haiku"
    label: cheap
```

`GET /models` on the gateway was run this lap and lists `claude-4-5-opus`,
`claude-4-6-opus`, `claude-4-7-opus`, `claude-4-8-opus`, `claude-4-5-haiku`,
`claude-4-5-sonnet`, `claude-4-6-sonnet` and `claude-5-sonnet`, so both matrix
ids and the judge id are real.

**The injection route does not change:** the model rides on the provider's own
command line as `--model`, deliberately not a promptfoo `--var` an ambient env
var could outrank. `run-turn.mjs` still forwards it as `GTD_PLANNERMODEL`
through `scrubbedEnv`'s overrides.

**Keeping the labels keeps the `provider label|variant` cell keys valid** —
`planner|clean`, `planner|violation`, `cheap|clean`, `cheap|violation` — which
is the cheaper path, and `compareCells` fails a cell missing from either side by
design.

### The baseline

**`evals/baseline.json` is re-recorded in this package, not left for later.** A
stale-but-key-compatible baseline is worse than a missing one because it passes
silently; the committed 4/4 is an unverified placeholder, so nothing real is
lost. Procedure: a real `npm run eval`, read the printed matrix, then
`npm run eval:baseline`.

**`recordedAt` must come out an ISO timestamp, not the placeholder sentence, and
the file must be an oxfmt fixed point** — `compare-baseline.mjs` already runs
`OXFMT_BIN` on write, so this holds if that path is used and not a hand edit.

**Cost, stated plainly: recording the baseline is 16 real agentic turns** — 2
providers × 2 variants × `--repeat 4` — each with a 600s ceiling, at
`--max-concurrency 2`. That is the price of the concern, not an overrun.

### Testing

**Nothing in this package is on `npm test`'s path, so no scenario and no unit
test is added.** `npm run eval` is a deliberate human action, and
`tests/tooling/eval-baseline.test.ts` — the only unit coverage that touches
`evals/` — imports `evals/compare-baseline.mjs`, which this package does not
change. The gates that do react are `npm run deadcode` (handled by the
`.fallowrc.json` entry) and `format:check` (handled by recording the baseline
through `compare-baseline.mjs`).

### Risks

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

### Acceptance

With `ANTHROPIC_API_KEY` unset and no `claude` on `PATH`, one trial runs end to
end and prints its JSON line; `evals/run-turn.mjs` names neither `claude` nor
`ANTHROPIC_API_KEY`; `grep -r anthropic evals/` returns nothing; a run with
`claude-4-5-sonnet` passed as `--model` still fails at startup; a real
`npm run eval` completes; `npm run eval:baseline` writes a `recordedAt` that is
a timestamp rather than the placeholder sentence, and the committed file is an
oxfmt fixed point.

## Running the eval needs only `GTD_EVALS_URL` and `GTD_EVALS_KEY`

Concern 4, PRODUCT, lands last — it states as fact what the merged package makes
true. Files: `package.json` and `docs/development.md`. No `evals/` file changes.

### The credential guard

**`package.json`'s `eval` script replaces its single `ANTHROPIC_API_KEY` check
with two `:?` expansions, one per variable, so the message names which one is
missing:**

```
: "${GTD_EVALS_URL:?GTD_EVALS_URL is required — the OpenAI-compatible base URL the eval runs against}" && : "${GTD_EVALS_KEY:?GTD_EVALS_KEY is required — the API key for GTD_EVALS_URL}" && npx turbo run build && node evals/eval.mjs
```

**Same shape as today: it fails before `npx turbo run build`,** so a missing
credential does not cost a build first. Two expansions rather than one combined
test, because a combined test cannot say which variable is absent.

**No binary prerequisite replaces `claude` on `PATH`.** pi arrives with
`npm install`. The prerequisites really are two environment variables and
nothing else — the concrete win of choosing a dependency over an installed CLI.

### The doc rewrite

`docs/development.md`'s "Prompt evals" section is the only place a person learns
how to run this.

- **The prerequisites paragraph names `GTD_EVALS_URL` and `GTD_EVALS_KEY` and
  drops both Claude prerequisites** — including the parenthetical explaining
  that driver turns run through the `claude` CLI's own auth.
- **Both occurrences of the `gtd next` → `claude -p` → `gtd land` cycle become
  `gtd next` → `pi -p` → `gtd land`.** It appears twice; missing one leaves the
  doc self-contradicting.
- **A new sentence names pi's pinned version and its four-tool surface (`read`,
  `write`, `edit`, `bash`) as grading parameters, beside the model matrix.** A
  reader comparing two baselines needs to know the harness moved, not just the
  model.
- **The flakiness paragraph survives verbatim** — one bad turn is 25% of a
  4-trial cell, the eval is never a CI gate, and the fix for routine re-runs is
  more trials rather than a softer threshold.
- **The placeholder-baseline caveat is deleted, not reworded,** because the
  merged package records a real baseline.

**AGENTS.md's documentation rule still binds this section: it must not name a
`src/*.ts` module, an internal function, or a private type.** Naming `evals/*`
files is fine and already the existing style.

### Error handling

None beyond the guard. This package adds no code path that can fail at runtime.

### Testing

**No scenario and no unit test.** `docs/**` is already declared in `test:unit`'s
and both e2e tasks' `inputs` in `turbo.json` (because
`tests/integration/features/driver-doc.feature` runs `docs/driver.md` as
executable code), so editing `docs/development.md` correctly busts those caches
— but `docs/development.md` itself is not doc-tested, and this package adds no
new check, so `tests/tooling/turbo.test.ts` needs nothing.

### Risk

**`grep -rn ANTHROPIC_API_KEY .` is the acceptance and it sweeps the whole
tree.** Run it with `node_modules`, `.git` and the untracked
`evals/results.json` excluded, or it reports hits that are not this repository's
to fix.

### Acceptance

`grep -rn ANTHROPIC_API_KEY .` returns nothing outside git history, and the
doc's prerequisites paragraph names both variables.

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

Recorded in this change, under the merged package. The gate already ships
known-wrong; carrying a placeholder across an endpoint swap turns a loud first
failure into a silent stale pass.

### Does the fixture builder change?

Only `scrubbedEnv`. `evals/fixture.mjs`'s `buildFixture`,
`evals/cases/spec-review.mjs`, and `evals/asserts/spec-review.mjs` are
model-agnostic — they build a repo, plant a defect, and grade files that
changed. Only the thing that drives the turn and the thing that judges its prose
touch a model.

### Which pi version is pinned?

`0.84.4`, the `latest` tag, exactly and with no caret. The `legacy-node20` tag
(`0.74.2`) is for Node 20 and this repo's `engines` is `>=22`, so the older tool
surface buys nothing.

### Does a new module hold the pi wiring, or does it live in `run-turn.mjs`?

`run-turn.mjs`. That file is already the "drive exactly one turn" module and pi
is exactly that job; a fifth `evals/*.mjs` would split one decision across two
files for no gain.

### Where does pi's config directory live?

A separate `mkdtempSync` under the OS tmpdir, a sibling of the fixture repo.
Inside the repo, pi's own files would land in `git diff` after `gtd land` and be
graded as `otherFilesChanged`.

### Is `--model` passed bare or provider-qualified?

Provider-qualified as `gtd-evals/<id>`. pi's `--model` takes a pattern that can
match a built-in catalog entry, and `provider/id` is pi's documented way to
force the provider. The `JUDGE_MODEL` guard still compares the bare id; the
prefix is added only at the spawn.

### Does `scrubbedEnv` also drop `OPENAI_*`?

Yes. `evals/eval.mjs` now sets `OPENAI_BASE_URL`/`OPENAI_API_KEY` for the judge,
promptfoo spawns `run-turn.mjs`, and those values reaching pi could outrank the
provider the harness just declared.

### Does this change add a cucumber scenario?

No. Nothing here is reachable from `npm test` — `npm run eval` is a deliberate
human action, and the one unit test that touches `evals/`
(`tests/tooling/eval-baseline.test.ts`) covers `compare-baseline.mjs`, which
does not change.

### How many trials record the baseline?

Four, `evals/eval.mjs`'s existing `--repeat 4` default. A cheaper `--repeat 2`
would make each cell's rate a coarse 0/50/100%, and a coarse floor lets a real
3/4 regression pass.
