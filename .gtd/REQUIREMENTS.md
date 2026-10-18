## Concerns

### 1. Settle the #355 trailer gap (PRODUCT)

#371 asks for a decision, not a feature. **Decision: scope #355's "trailers for
every gate" acceptance to default-flag gates.** Flag-gated gates (`seam.judge`,
risk tier) leave trailers only when their flag is on, and SDLC.md says so as a
plain scope, not a known gap. **Docs-only change; #371 closes when this branch
merges.** **The risk-tier gate stays never dogfooded** — accepted, no tracking
issue filed. The #384 naive-pass run is not cited as a `seam.judge` record.

Today SDLC.md says only **"A default setup records no `seam.judge` judgment or
`Gtd-Mark: risk-tier` trailers (#371)"** — a known-gap note pointing at an open
issue. After this branch that line states the scope and no longer points at
#371.

### 2. Reword SDLC.md's #371 line (TECHNICAL)

Rewrite lines 77-78 of `SDLC.md` as a scope statement: `seam.judge` judgments
and `Gtd-Mark: risk-tier` trailers appear only when `GTD_FLAG_NAIVE_PASS` /
`GTD_FLAG_RISK_TIER` is on; a default setup records neither. Drop the `(#371)`
reference. Keep it user-facing: name the flags, never a `src/*.ts` module. Keep
it an oxfmt fixed point.

### 3. Close #371 from the merge (TECHNICAL)

The squash message carries `Closes #371`, per `docs/commits.md`.

## Answered Questions

### How does #371 close: rerun the dogfood with both flags on, or scope the #355 acceptance line?

Scope the acceptance line to default-flag gates (human's pick). SDLC.md states
that flag-gated gates leave trailers only when their flag is on; docs-only,
closes #371 now; the risk-tier gate stays never dogfooded.

### Do the three deleted `## Deferred review notes` entries (note-1, note-2, note-3) get folded in?

No. The start diff deletes all three sections; the removal is the human's call
to drop them, so none of them is part of this work.

### Does README.md change?

No. README states the flags' behaviour, not the dogfood's acceptance; only
SDLC.md carries the #371 gap.

### Does this branch flip either flag's default (`defaultOn`) or turn them on for gtd's own repo?

No. #371 asks about the dogfood's acceptance, not rollout; flipping a default is
`rollout`'s job and needs its own process.
