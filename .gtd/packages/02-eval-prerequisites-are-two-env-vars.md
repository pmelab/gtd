# Running the eval needs only `GTD_EVALS_URL` and `GTD_EVALS_KEY`

Lands last — it states as fact what the harness change makes true.

Primary paths: `package.json`, `docs/development.md`. No `evals/` file changes.

## Requirement

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

## Tasks

### Replace the credential guard in the `eval` script

- [ ] `package.json`'s `eval` script no longer tests `ANTHROPIC_API_KEY`
- [ ] It uses two separate `:?` expansions, one per variable, so the message
      names which one is missing — a single combined test cannot
- [ ] The shape is unchanged: it fails BEFORE `npx turbo run build`, so a
      missing credential does not cost a build first
- [ ] The script reads:
      `: "${GTD_EVALS_URL:?GTD_EVALS_URL is required — the OpenAI-compatible base URL the eval runs against}" && : "${GTD_EVALS_KEY:?GTD_EVALS_KEY is required — the API key for GTD_EVALS_URL}" && npx turbo run build && node evals/eval.mjs`
- [ ] Running `npm run eval` with `GTD_EVALS_URL` unset fails naming
      `GTD_EVALS_URL`
- [ ] Running `npm run eval` with only `GTD_EVALS_KEY` unset fails naming
      `GTD_EVALS_KEY`
- [ ] No binary prerequisite replaces `claude` on `PATH` — pi arrives with
      `npm install`

Paths: `package.json`.

### Rewrite the "Prompt evals" section of the development doc

- [ ] The prerequisites paragraph names `GTD_EVALS_URL` and `GTD_EVALS_KEY`
- [ ] It drops both Claude prerequisites, including the parenthetical explaining
      that driver turns run through the `claude` CLI's own auth
- [ ] BOTH occurrences of the `gtd next` → `claude -p` → `gtd land` cycle become
      `gtd next` → `pi -p` → `gtd land` — it appears twice, and missing one
      leaves the doc self-contradicting
- [ ] A sentence names pi's pinned version and its four-tool surface (`read`,
      `write`, `edit`, `bash`) as grading parameters, beside the model matrix —
      a reader comparing two baselines needs to know the harness moved, not just
      the model
- [ ] The flakiness paragraph survives verbatim: one bad turn is 25% of a
      4-trial cell, the eval is never a CI gate, and the fix for routine re-runs
      is more trials rather than a softer threshold
- [ ] The placeholder-baseline caveat is DELETED, not reworded
- [ ] The section names no `src/*.ts` module, no internal function, and no
      private type — naming `evals/*` files is fine and is the existing style

Paths: `docs/development.md`.

### Confirm the test graph needs nothing

- [ ] No cucumber scenario and no unit test is added — this package adds no
      runtime code path that can fail
- [ ] No new check is added, so `turbo.json` and `tests/tooling/turbo.test.ts`
      need nothing
- [ ] `docs/**` is already declared in `test:unit`'s and both e2e tasks'
      `inputs`, so editing `docs/development.md` busts those caches correctly
- [ ] `npm test` is green

Paths: none changed.

## Risk

**`grep -rn ANTHROPIC_API_KEY .` is the acceptance and it sweeps the whole
tree.** Run it with `node_modules`, `.git` and the untracked
`evals/results.json` excluded, or it reports hits that are not this repository's
to fix.

## Acceptance

- [ ] `grep -rn ANTHROPIC_API_KEY .` returns nothing outside git history
- [ ] The doc's prerequisites paragraph names both variables
