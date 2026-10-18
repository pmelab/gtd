## Open Questions

### How should the public `buildTail` and `implement` signatures change for config authors?

Both are exported from `@pmelab/gtd/workflows` (tier "Follows package SemVer"),
and `docs/configuration.md` shows `buildTail(true, start())`. Any signature
change breaks every user `gtd.config.ts` that calls them; the fork is whether
gtd takes that break now or carries the old form.

- [ ] Hard break: options object only, old positional calls stop type-checking
      and misbehave
  - Major release; commit needs a literal `BREAKING CHANGE:` footer
    (semantic-release cuts nothing for a bare `refactor!:`)
  - Smallest, cleanest code; no dual-shape detection
  - Every documented example and ~20 `.feature` files rewritten in the same
    change
- [x] Accept both: options object is the new form, positional form still works
      and is marked `@deprecated`
  - Minor release, no user config breaks
  - Runtime shape detection (first arg boolean vs object) stays until a later
    major removes it
  - Docs show only the new form
- [ ] Refactor only the internal one (`refactorBuildingPrompt`); leave
      `buildTail` and `implement` untouched
  - No release impact at all
  - Drops two of the three functions the sketch names
- [ ] _your answer_

### Does the required `base` argument of `buildTail` move into the options object too?

`base` is a required string, not a boolean; the sketch says "positional and
boolean params". The fork is the call shape config authors write.

- [ ] Everything in one object: `buildTail({ base, fixFirst, green, ...rest })`
  - One shape for all three functions; `base` becomes a required field
  - `fixFirst` gets a default (`false`), so most calls name only `base`
- [x] Keep `base` positional: `buildTail(base, { fixFirst, green, ...rest })`
  - Required input stays positional; only the flags move
  - Mirrors `review(base, …)` and other `base`-first helpers
- [ ] _your answer_

## Concerns

### 1. `buildTail` takes an options object — PRODUCT

- Today:
  `buildTail(fixFirst: boolean, base: string, green = false, options: BuildTailOptions = {})`
- Fold `fixFirst` and `green` into `BuildTailOptions`; shape of `base` and
  compatibility per the open questions
- **Behaviour unchanged**: same defaults (`green` false), same tail run
- Update every call site: `src/workflows/feature/feature.ts`,
  `src/workflows/feature/refactor.ts`, `src/workflows/feature/review.test.ts`,
  `src/workflows/feature/feature.test.ts`, and the inline configs in
  `tests/integration/features/*.feature`

### 2. `implement` takes an options object — PRODUCT

- Today:
  `implement(reference: string | undefined, tier?: RiskTier, amend?: boolean)`
- Becomes `implement({ reference, tier, amend })`, all fields optional
- Public export (via `export * from "./feature/seam.js"`) — compatibility per
  the first open question
- Update call sites: `src/workflows/feature/feature.ts` (two calls),
  `src/workflows/feature/seam.test.ts`

### 3. `refactorBuildingPrompt` takes an options object — TECHNICAL

- Today:
  `refactorBuildingPrompt(pkg, strays, pattern, reference?, feedback = false)`
- Internal only (`shared/text.ts` is not re-exported beyond `agentWithSkills`):
  no compatibility concern
- **Prompt text byte-identical** for every input; existing `text.test.ts` cases
  pin it
- Update call sites: `src/workflows/feature/refactor.ts`,
  `src/workflows/shared/text.test.ts`

### 4. Docs follow the new shape — PRODUCT

- `docs/configuration.md` hotfix example (`buildTail(true, start())`) rewritten
  to the new form
- README checked for any call-shape mention; none today beyond prose

### 5. Process constraints for this dogfood run (#384) — TECHNICAL

- **Skip `scripts/test-states*`**: never edited, even if a search hits them
- **Refactor-first or abandon**: if the seam judge does not route this through
  `refactor-first`, abandon the process rather than build it another way
- **Deferred review notes (836985b, daed27f, eda53bb) dropped**: the human
  deleted them from `.gtd/TODO.md`; they are not part of this change

## Answered Questions

### Does `refactorBuildingPrompt` need a compatibility path?

No — it is internal to the workflows package, so it switches to an options
object outright.

### Are `scripts/test-states*` in scope?

No — the sketch says skip them explicitly.

### Are the three deferred review notes folded into this change?

No — the human removed them from `.gtd/TODO.md` in the start diff, so they are
discarded, not parked.

### What happens if the change does not land on the `refactor-first` path?

Abandon the process — the sketch says "Want refactor-first; else abandon", since
#384's goal is to dogfood exactly that path.
