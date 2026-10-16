# Requirements

Source: pmelab/gtd#355 — dogfood one small, composable gtd feature through the
whole release-flag lifecycle: flag registry entry, tests in both flag states,
rollout, cleanup.

## Concerns

### 1. Default `llm` judge model `haiku` → `sonnet`, behind a new release flag (PRODUCT)

- New registry entry `judge_sonnet` (`GTD_FLAG_JUDGE_SONNET`):
  `kind: "release"`, owner `pmelab`, expiry `2027-01-15`, default off.
- Flag off: the `llm` provider's built-in default stays `haiku`, identical to
  today. Flag on: the built-in default is `sonnet`.
- **The flag moves only the last-resort default**: `--model`, then
  `GTD_JUDGE_MODEL`, then `judge.json` `model` still win over it in both states.
- **Once rolled out, judge calls on `llm` get slower and costlier for every user
  who has not pinned a model** — call this out in the docs.
- The flag is resolved from the live env through the registry's resolver — never
  a raw `process.env` check. Judging is not replayed, so reading the live value
  there is allowed.
- **Only `gtd judge run --provider llm` changes; the Claude Code mod's judge
  subagent stays on `GTD_JUDGE_MODEL` or its hard-coded `haiku`** in both flag
  states — no mod code or mod tests change.
- **While the flag is on, the two paths that send the same judge prompt run on
  different models** (`sonnet` via `gtd judge run`, `haiku` in the mod); the
  docs say so next to the flag-dependent default.
- **Every release flag adds a full vitest pass to every gate and to CI**; gate
  time grows until cleanup removes the flag.
- `@inmem` cucumber scenarios cover both flag states; unit tests pin flag-on and
  flag-off defaults and that an explicit model beats the flag.
- README, `docs/driver.md` (llm provider default, calibration-risk paragraph)
  and the `gtd judge run` help text describe the flag-dependent default.
  **`docs/cli.md`'s `## Commands` block is pinned to the rendered help**, so a
  help-text change must regenerate it.

### 2. Make `rollout` and `cleanup` startable in this repo (TECHNICAL)

- `gtd.config.ts` holds `rollout` and `cleanup` back with a comment that the
  PATH gtd lacks them. **PATH gtd is now 27.6.0; both shipped in 27.2.0**, so
  export them (registry path stays the default `src/flags/index.ts`).
- Without this, the later rollout and cleanup processes cannot start.

### 3. Rollout and cleanup run as their own later processes, on this branch (PRODUCT)

- Not built in this process. After the flag lands, on this same branch:
  `gtd --workflow rollout --var flag=judge_sonnet`, then
  `gtd --workflow cleanup --var flag=judge_sonnet`.
- One PR, merged with a merge commit or rebase — **never squash**, or the three
  commits collapse into one and the acceptance line fails.
- **The flag never ships default-off in a release**; rollout is simulated, not
  observed in the wild.

### 4. Gate coverage: default workflow only (PRODUCT)

- This process keeps `flag_naive_pass=0` and `flag_risk_tier=0`.
- **"Trailers for every gate" is only partly met: no `seam.judge` and no
  `Gtd-Mark: risk-tier` trailers will land.** Record that gap as a friction
  follow-up, not a silent omission.

### 5. Friction follow-ups, filed by the agent (PRODUCT)

- Last package of each of the three processes (this one, rollout, cleanup): one
  `gh issue` per friction point hit during that process, labelled
  `track:dogfood`, referencing #355.
- Search open `track:dogfood` issues first and comment on a match instead of
  filing a duplicate.
- They feed #356 (SDLC docs), which this issue blocks.

## Answered Questions

### Should the two deferred review notes the human deleted from `.gtd/TODO.md` be folded in?

No. The human's sketch removed both could-tier notes (garbled-flag stdout
assertion, `gtd history list` kept-ref scenario) and replaced them with #355;
the issue asks for one feature, and extra test work would blur the dogfood run.

### Does this process cover rollout and cleanup itself?

No. The shipped `rollout` and `cleanup` workflows exist to do exactly those
steps as separate processes with their own commits; this process lands the
flag-gated feature plus the config export they need.

### Which feature ships behind the flag?

Swap the default `llm` judge model from `haiku` to `sonnet` — the smallest
change, with trivial tests in both flag states.

### Should this process run with the naive-pass and risk-tier gates on?

No. Keep going with both off; seam and risk-tier trailers stay untested this
run.

### How do land, rollout and cleanup reach `main`?

One branch, three processes, one PR merged with a merge commit or rebase, never
squash.

### Who files the friction follow-up issues, and when?

The agent, one `gh issue` per friction point, as the last package of each of the
three processes, labelled `track:dogfood`.

### What is the flag called?

`judge_sonnet` (`GTD_FLAG_JUDGE_SONNET`): names the behaviour it turns on, and
it lives only until cleanup.

### When does the flag expire?

`2027-01-15`, matching the two existing release flags; rollout and cleanup run
right after on this branch, so it is far past the flag's real life.

### Does the flag override an explicitly chosen model?

No. It moves only the built-in fallback; `--model`, `GTD_JUDGE_MODEL` and
`judge.json` keep their precedence, so no user who pinned a model sees a change.

### Does the flag also move the Claude Code mod's judge subagent to `sonnet`?

No. Only `gtd judge run --provider llm` changes; the mod stays on `haiku`, and
the docs note that the two paths diverge in model while the flag is on.
