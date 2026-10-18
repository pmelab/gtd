## Interfaces

None. **Docs-only change: no signature, config key, flag default or CLI output
moves.**

## Call Stacks

None. No code path changes.

## E2E Scenarios

No e2e change. Only `SDLC.md` prose changes; no command, flag or output does.

## Unit Tests

### Chores

- chore: SDLC.md — replace lines 77-78 ("A default setup records no `seam.judge`
  judgment or `Gtd-Mark: risk-tier` trailers (#371).") with a bold scope
  statement: **`seam.judge` judgments appear only with `GTD_FLAG_NAIVE_PASS` on,
  `Gtd-Mark: risk-tier` trailers only with `GTD_FLAG_RISK_TIER` (and
  `GTD_FLAG_NAIVE_PASS`) on; a default setup records neither.** No `#371`, no
  `src/*.ts` name, no known-gap wording; existing
  `tests/tooling/sdlc-doc.test.ts` link checks and `format:check` must stay
  green (covers 1. Settle the #355 trailer gap + 2. Reword SDLC.md's #371 line)
- chore: squash commit message — `docs:` type per `docs/commits.md`, body
  carries `Closes #371`; not breaking, no `!` (covers 3. Close #371 from the
  merge)

## Merged Concerns

### 1 + 2 → one SDLC.md edit

Both footprints are the same two lines of `SDLC.md`; concern 2 is the wording of
concern 1's decision, not a consumer of a new interface.

- **1. Settle the #355 trailer gap (PRODUCT):** #371 asks for a decision, not a
  feature. Decision: scope #355's "trailers for every gate" acceptance to
  default-flag gates. Flag-gated gates (`seam.judge`, risk tier) leave trailers
  only when their flag is on, and SDLC.md says so as a plain scope, not a known
  gap. Docs-only change; #371 closes when this branch merges. The risk-tier gate
  stays never dogfooded — accepted, no tracking issue filed. The #384 naive-pass
  run is not cited as a `seam.judge` record. Today SDLC.md says only "A default
  setup records no `seam.judge` judgment or `Gtd-Mark: risk-tier` trailers
  (#371)" — a known-gap note pointing at an open issue. After this branch that
  line states the scope and no longer points at #371.
- **2. Reword SDLC.md's #371 line (TECHNICAL):** Rewrite lines 77-78 of
  `SDLC.md` as a scope statement: `seam.judge` judgments and
  `Gtd-Mark: risk-tier` trailers appear only when `GTD_FLAG_NAIVE_PASS` /
  `GTD_FLAG_RISK_TIER` is on; a default setup records neither. Drop the `(#371)`
  reference. Keep it user-facing: name the flags, never a `src/*.ts` module.
  Keep it an oxfmt fixed point.

## Answered Questions

### How does #371 close: rerun the dogfood with both flags on, or scope the #355 acceptance line?

Scope the acceptance line to default-flag gates (human's pick); docs-only,
closes #371 now; the risk-tier gate stays never dogfooded.

### Do the three deleted `## Deferred review notes` entries (note-1, note-2, note-3) get folded in?

No. The human dropped them; none is part of this work.

### Does README.md change?

No. README already states both flags are off by default; only SDLC.md carries
the #371 gap.

### Does this branch flip either flag's default (`defaultOn`) or turn them on for gtd's own repo?

No. Flipping a default is `rollout`'s job and needs its own process.

### Does the risk-tier sentence name `GTD_FLAG_NAIVE_PASS` too?

Yes. SDLC.md line 28-29 and README say risk tier acts only with
`GTD_FLAG_NAIVE_PASS` on; naming one flag alone would misstate it.

### Does the new line need a test?

No. Prose scope statement; existing `sdlc-doc.test.ts` link checks and
`format:check` already guard the file, and a string-pin test would only freeze
wording.
