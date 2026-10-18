## Open Questions

### How does #371 close: rerun the dogfood with both flags on, or scope the #355 acceptance line?

#355's "trailers for every gate" is half met. History already holds one
naive-pass run (#384, `flag_naive_pass=1`, `flag_risk_tier=0`): `seam.judge`
step trailers exist (`772d69db`), on a branch and its `refs/gtd/history/*` ref
only, not on `main`. **No `Gtd-Mark: risk-tier` trailer exists anywhere.** The
options differ in whether this branch ships a run, a doc change, or both.

- [x] Scope the acceptance line to default-flag gates
  - SDLC.md's #371 line becomes a stated scope: flag-gated gates (`seam.judge`,
    risk tier) leave trailers only when their flag is on
  - Docs-only change; closes #371 now
  - The risk-tier gate stays never dogfooded
- [ ] Credit #384 for `seam.judge`, scope out risk tier only
  - SDLC.md cites the #384 run as the `seam.judge` record and says risk tier has
    no dogfood record yet
  - Docs-only change; closes #371 now
  - **Risk: the #384 judgment went through #394's bug** (every verdict refused),
    so it records the cautious route, not a real judge ruling
- [ ] Require a dogfood run with both flags on, then drop the #371 line
  - This process cannot be that run: its flags are pinned off
    (`flag_naive_pass=0`, `flag_risk_tier=0`)
  - **Blocked on #394** (judge can never answer `seam.judge`) and likely #395;
    this branch only files a tracking issue and keeps #371 open
  - Only option that yields real trailers for every gate
- [ ] _your answer_

## Concerns

### 1. Settle the #355 trailer gap (PRODUCT)

#371 asks for a decision, not a feature. Fold the answer above into one outcome:
either SDLC.md states the scope plainly, or a both-flags-on dogfood run is
tracked and #371 stays open until it lands. Today SDLC.md says only **"A default
setup records no `seam.judge` judgment or `Gtd-Mark: risk-tier` trailers
(#371)"** — a known-gap note pointing at an open issue. Whatever the answer,
that line stops pointing at an open #371 once this branch merges.

### 2. Reword SDLC.md's #371 line (TECHNICAL)

Rewrite lines 77-78 of `SDLC.md` per concern 1. Keep it user-facing: name the
flags (`GTD_FLAG_NAIVE_PASS`, `GTD_FLAG_RISK_TIER`), never a `src/*.ts` module.
Keep it an oxfmt fixed point.

### 3. Close #371 from the merge (TECHNICAL)

The squash message carries `Closes #371` when the answer closes it now,
`Refs #371` otherwise, per `docs/commits.md`.

## Answered Questions

### Do the three deleted `## Deferred review notes` entries (note-1, note-2, note-3) get folded in?

No. The start diff deletes all three sections; the removal is the human's call
to drop them, so none of them is part of this work.

### Does README.md change?

No. README states the flags' behaviour, not the dogfood's acceptance; only
SDLC.md carries the #371 gap.

### Does this branch flip either flag's default (`defaultOn`) or turn them on for gtd's own repo?

No. #371 asks about the dogfood's acceptance, not rollout; flipping a default is
`rollout`'s job and needs its own process.
