# Review: 76efc42

<!-- base: 59c00e546c9c734fa7722ba0d1a70b3451277a20 -->

The eval harness stops shelling out to the `claude` CLI and drives turns with
the `pi` coding agent instead, pointed at one OpenAI-compatible gateway. All
credentials collapse from `ANTHROPIC_API_KEY` + `claude`'s own auth into two
vars, `GTD_EVALS_URL` and `GTD_EVALS_KEY`. The baseline stops being a
placeholder and records a real run.

## Swap the driver turn from `claude -p` to `pi -p`

The one agent turn per trial now spawns the repo-local `pi` binary against a
per-turn config directory that declares exactly the model under test. Session
continuity is dropped (`--no-session`) since a trial is a single turn.

- [ ] ./evals/run-turn.mjs#159 — `writePiConfig` writes a throwaway
      `models.json` per turn declaring the gateway as an `openai-completions`
      provider The temp dir from `mkdtempSync` is never removed — not on
      success, not on failure, and not under `EVAL_CLEAN=1`, which does clean
      fixture repos. A 16-trial run leaves 16 `gtd-eval-pi-*` dirs in `$TMPDIR`.
      Small, but it contradicts what `EVAL_CLEAN=1` promises.
- [ ] ./evals/run-turn.mjs#209 — the gateway key is passed as an `--api-key`
      argv element Argv is world-readable in `ps` on most systems; the old code
      kept the credential in the environment. The comment justifies avoiding
      `models.json` interpolation, which is right, but `piEnv` at line 197 was a
      third option — the spawn env is constructed by hand there and could carry
      the key without ever touching argv or the config file.
- [ ] ./evals/run-turn.mjs#196 — the served-model preflight validates `model`
      (the CLI flag) while the turn actually runs `turnModel`, read back from
      `gtd next --json=model` These are the same value only as long as the
      workflow state echoes `GTD_PLANNERMODEL` unchanged. If a state ever pins
      its own model, the `/models` check at line 74 and the judge-model guard at
      line 22 both inspect an id that is not the one being graded. Worth a check
      on `turnModel` instead, or in addition.
- [ ] ./evals/run-turn.mjs#206 — `--no-session` replaces `--session-id`, so
      `gtd next --json=session.id` is no longer read anywhere in the eval
      Correct for a single-turn trial, but it does drop the only exercise of
      that field in this harness.
- [ ] ./evals/run-turn.mjs#211 — `-nc` disables `AGENTS.md`/`CLAUDE.md`
      discovery, but extension and skill discovery are left on `pi` also
      supports `-ne` (no extensions) and `-ns` (no skills). With those off, a
      stray extension could add tools or change behaviour between runs and the
      baseline would silently move. `PI_CODING_AGENT_DIR` isolates the global
      config, so the exposure is project-local discovery only — confirm that is
      actually closed before trusting the pin.

## Preflight checks go async and gain a gateway probe

Startup validation now hits `GET $GTD_EVALS_URL/models` and fails the trial if
the model under test is not served, rather than discovering it 16 doomed turns
later.

- [ ] ./evals/run-turn.mjs#62 — `fetchServedModelIds` throws on both an
      unreachable gateway and a non-2xx, and the caller turns either into a hard
      failure This is the right call and the comment says why. Note there is no
      timeout on the `fetch`, so a hanging gateway hangs the trial at startup
      with no message; promptfoo's own timeout is the only backstop.
- [ ] ./evals/run-turn.mjs#89 — the check list splits into a sync
      `baseInfraChecks` plus one appended async check Every check is still
      evaluated before any is reported, so a missing bundle and a missing key
      both surface in the same run rather than one at a time.
- [ ] ./evals/run-turn.mjs#22 — the judge guard tightens from
      `JUDGE_MODEL.includes(model)` (substring) to strict `===` Under the new
      flat ids (`claude-4-5-opus` vs `claude-4-5-sonnet`) substring matching
      would no longer fire anyway, so strict equality is the honest form.
      Confirm no future id is a prefix of another.

## Credentials collapse to two gateway vars

`ANTHROPIC_API_KEY` and `claude`-on-`PATH` are gone. Both the graded turn and
the tier-3 judge reach the model through the same gateway, and no credential is
written into any committed file.

- [ ] ./package.json#49 — the `eval` script now hard-fails unless both
      `GTD_EVALS_URL` and `GTD_EVALS_KEY` are set
- [ ] ./evals/eval.mjs#94 — `eval.mjs` maps the two vars onto
      `OPENAI_BASE_URL`/`OPENAI_API_KEY` in promptfoo's spawn env, so the
      `openai:` judge provider resolves without the YAML holding a secret
- [ ] ./evals/promptfooconfig.yaml#47 — the judge moves from
      `anthropic:messages:claude-sonnet-4-5-20250929` to
      `openai:chat:claude-4-5-sonnet` The judge is no longer pinned to a dated
      model id — `claude-4-5-sonnet` is whatever the gateway maps it to today.
      That is a real loss of reproducibility for the grading tier, and the
      baseline it produces inherits it. Deliberate, or worth pinning the gateway
      alias?
- [ ] ./evals/fixture.mjs#34 — `scrubbedEnv` grows from scrubbing `GTD_*` to
      scrubbing `GTD_*`, `PI_*`, and `OPENAI_*` Necessary: without it the
      fixture's own `gtd` invocations would inherit the gateway credentials. The
      knock-on is documented in the JSDoc — every read of
      `GTD_EVALS_URL`/`GTD_EVALS_KEY` must now happen in the parent before
      scrubbing, which line 297 of run-turn.mjs does.

## Baseline records a real run

- [ ] ./evals/baseline.json#2 — `recordedAt` becomes a real timestamp and the
      placeholder warning string is gone `cheap|violation` records 3/4, not 4/4.
      That bakes a 0.75 floor into the regression gate for that cell permanently
      — `compare-baseline.mjs` only fails on a rate that _drops_, so a run that
      later scores 4/4 will not raise the floor unless someone re-records.
      Confirm the 3/4 was the documented flake and not a real prompt weakness
      being enshrined.
- [ ] ./docs/development.md#101 — the paragraph warning that the baseline was an
      unverified placeholder is deleted Correct now that a real run exists.

## Docs and dependency bookkeeping

- [ ] ./docs/development.md#36 — prerequisites rewritten to the two gateway
      vars; the turn cycle is described as `gtd next` → `pi -p` → `gtd land`
- [ ] ./docs/development.md#50 — new paragraph stating grading is versioned on
      the harness too, "pinned to `pi-coding-agent` 0.84.4, restricted to a
      four-tool surface (`read`, `write`, `edit`, `bash`)" The four-tool surface
      is `pi`'s default, not something this code pins — no
      `--tools read,write,edit,bash` is passed at run-turn.mjs#202. The doc
      reads as a guarantee the code does not make; a `pi` version bump could
      widen the surface with nothing failing. Either pass the flag or soften the
      sentence.
- [ ] ./package.json#56 — `@earendil-works/pi-coding-agent` pinned exactly to
      `0.84.4`, no caret The exact pin is right for a graded harness. It pulls
      136 new entries into the lockfile, including the full AWS Bedrock and
      Google GenAI SDK trees, for a devDependency used by one eval script.
- [ ] ./.fallowrc.json#26 — added to `ignoreDependencies` with a comment
      explaining it is spawned as a binary, never imported Same treatment
      `promptfoo` already had.
