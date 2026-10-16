# Requirements

Source: pmelab/gtd#355 — dogfood one small, composable gtd feature through the
whole release-flag lifecycle: flag registry entry, tests in both flag states,
rollout, cleanup.

## Open Questions

### Which feature ships behind the flag?

The issue only gives an example ("a provider swap in judge"). The pick sets how
much code the flag guards, and what cleanup later has to delete.

- [ ] Swap the default `llm` judge model from `haiku` to `sonnet`
  - smallest possible change: flag-on swaps one constant; tests in both flag
    states are trivial
  - **judge calls get slower and more expensive for everyone on `llm` once
    rolled out**
  - only lightly exercises the composability claim: no new seam, no new provider
- [ ] Add a direct Anthropic API provider (`anthropic`), selectable only with
      the flag on
  - a real provider swap: calls the HTTP API through the existing fetch port, no
    `claude` CLI spawn
  - medium size: new provider module, live/in-memory contract cases, a new key
    env var, docs for `--provider` / `GTD_JUDGE_PROVIDER` / `judge.json`
  - **adds a new required secret (API key) for anyone who picks it**; cleanup
    leaves a permanent new public provider name
- [ ] _your answer_

### Should this process run with the naive-pass and risk-tier gates on?

**This process started with `flag_naive_pass=0` and `flag_risk_tier=0` pinned**,
so no `seam.judge` or `Gtd-Mark: risk-tier` trailers will land. Flags are pinned
at process start; turning them on means abandoning and restarting.

- [ ] Keep going with both off
  - no restart; "every gate" means the gates the default workflow runs today
  - **the acceptance line "trailers for every gate" is only partly met: seam and
    risk-tier gates go untested**
- [ ] Abandon, restart with `GTD_FLAG_NAIVE_PASS=1 GTD_FLAG_RISK_TIER=1`
  - exercises every gate, including the two newest and least-used ones
  - costs one restart of this triage
  - **more friction expected, which is the point of dogfooding, but slows the
    feature down**
- [ ] _your answer_

### How do land, rollout and cleanup reach `main`?

Acceptance wants the three in separate commits. **A GitHub squash-merge of one
PR collapses them into one commit**, so the shape has to be decided up front.

- [ ] Three PRs, one per process (land, then rollout, then cleanup), each merged
      before the next starts
  - each step gets its own release from semantic-release, so the flag actually
    ships default-off before it ships default-on
  - slowest; three review/merge cycles
- [ ] One branch, three processes, merged with a merge commit or rebase (no
      squash)
  - one PR, one review; all three commits survive on `main`
  - **the flag never ships default-off in a release**, so rollout is only
    simulated
  - breaks with the repo's usual squash-merge habit
- [ ] _your answer_

### Who files the friction follow-up issues, and when?

Friction surfaces across all three processes, not just this one. The fork is
whether filing issues is built work here or a human task at the end.

- [ ] Human files them after cleanup lands; this process files nothing
  - no extra package; nothing in the tree or in `.gtd/` tracks friction
  - **friction from this process is lost if nobody writes it down while it is
    fresh**
- [ ] The agent files one `gh issue` per friction point it hit, as the last
      package of each of the three processes
  - friction is captured while fresh, labelled `track:dogfood`
  - adds a non-code package to each process; issues may be noisy or duplicate
- [ ] _your answer_

## Concerns

### 1. The feature, behind a new release flag (PRODUCT)

- Ship the feature picked above, gated by a new `GTD_FLAG_<NAME>` release flag
  in the flag registry: `kind: "release"`, owner `pmelab`, an expiry date,
  default off.
- Flag off: behaviour identical to today. Flag on: the new behaviour.
- The flag is read where the judge runs, from the live env, through the flag
  registry's resolver — never a raw `process.env` check outside it.
- **Every release flag adds a full vitest pass to every gate and to CI** — the
  test runner flips each release flag alone. Expect gate time to grow until
  cleanup removes it.
- `@inmem` cucumber scenarios cover both flag states; unit tests pin flag-on and
  flag-off.
- README and `docs/` describe the user-visible change and the flag name, per
  CLAUDE.md.

### 2. Make `rollout` and `cleanup` startable in this repo (TECHNICAL)

- `gtd.config.ts` holds `rollout` and `cleanup` back with a comment that the
  PATH gtd lacks them. **PATH gtd is now 27.6.0; both shipped in 27.2.0**, so
  export them (registry path stays the default `src/flags/index.ts`).
- Without this, the later rollout and cleanup processes cannot start.

### 3. Rollout and cleanup run as their own later processes (PRODUCT)

- Not built in this process. After the flag lands:
  `gtd --workflow rollout --var flag=<name>`, then
  `gtd --workflow cleanup --var flag=<name>`.
- Their merge shape follows the answer on how the three reach `main`.

### 4. Friction follow-ups (PRODUCT)

- Filed per the answer above; label `track:dogfood`. They feed #356 (SDLC docs),
  which this issue blocks.

## Answered Questions

### Should the two deferred review notes the human deleted from `.gtd/TODO.md` be folded in?

No. The human's sketch removed both could-tier notes (garbled-flag stdout
assertion, `gtd history list` kept-ref scenario) and replaced them with #355;
the issue asks for one feature, and extra test work would blur the dogfood run.

### Does this process cover rollout and cleanup itself?

No. The shipped `rollout` and `cleanup` workflows exist to do exactly those
steps as separate processes with their own commits; this process lands the
flag-gated feature plus the config export they need.
