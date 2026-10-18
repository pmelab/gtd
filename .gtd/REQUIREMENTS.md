## Concerns

### 1. `buildTail` takes an options object, keeping `base` positional — PRODUCT

- Today:
  `buildTail(fixFirst: boolean, base: string, green = false, options: BuildTailOptions = {})`
- **New form: `buildTail(base, { fixFirst, green, ...rest })`** — `fixFirst` and
  `green` join `BuildTailOptions`; `fixFirst` defaults to `false`, `green` to
  `false`
- **Old positional form still works**: a TypeScript overload marked
  `@deprecated`; at runtime a boolean first argument selects the old form, a
  string selects the new one
- **Behaviour unchanged**: either form with the same inputs runs the same tail
- Update every call site to the new form: `src/workflows/feature/feature.ts`,
  `src/workflows/feature/refactor.ts`, `src/workflows/feature/review.test.ts`,
  `src/workflows/feature/feature.test.ts`, and the inline configs in
  `tests/integration/features/*.feature`
- At least one test pins the deprecated positional form so it cannot rot before
  a later major removes it

### 2. `implement` takes an options object — PRODUCT

- Today:
  `implement(reference: string | undefined, tier?: RiskTier, amend?: boolean)`
- **New form: `implement({ reference, tier, amend })`**, every field optional
- **Old positional form still works**: a `@deprecated` overload; at runtime a
  non-null object first argument selects the new form, a string or `undefined`
  the old one. `implement()` means the same in both
- Public export (via `export * from "./feature/seam.js"`), so minor release only
- Update call sites to the new form: `src/workflows/feature/feature.ts` (two
  calls), `src/workflows/feature/seam.test.ts`; one test pins the old form

### 3. `refactorBuildingPrompt` takes an options object — TECHNICAL

- Today:
  `refactorBuildingPrompt(pkg, strays, pattern, reference?, feedback = false)`
- Internal only (`shared/text.ts` is not re-exported beyond `agentWithSkills`):
  switches outright, no compatibility path
- **Prompt text byte-identical** for every input; existing `text.test.ts` cases
  pin it
- Update call sites: `src/workflows/feature/refactor.ts`,
  `src/workflows/shared/text.test.ts`

### 4. Docs follow the new shape — PRODUCT

- `docs/configuration.md` hotfix example (`buildTail(true, start())`) becomes
  `buildTail(start(), { fixFirst: true })`
- **Docs show only the new form**; the deprecated positional form is not
  documented
- README checked for any call-shape mention; none today beyond prose

### 5. Process constraints for this dogfood run (#384) — TECHNICAL

- **Skip `scripts/test-states*`**: never edited, even if a search hits them
- **Refactor-first or abandon**: if the seam judge does not route this through
  `refactor-first`, abandon the process rather than build it another way
- **Deferred review notes (836985b, daed27f, eda53bb) dropped**: the human
  deleted them from `.gtd/TODO.md`; they are not part of this change

## Answered Questions

### How should the public `buildTail` and `implement` signatures change for config authors?

Accept both: the options object is the new, documented form; the positional form
keeps working, marked `@deprecated`, detected at runtime by first-argument shape
until a later major removes it. Minor release, no user config breaks.

### Does the required `base` argument of `buildTail` move into the options object too?

No — `base` stays positional: `buildTail(base, { fixFirst, green, ...rest })`.
Only the flags move, mirroring other `base`-first helpers.

### Does using the deprecated positional form print a runtime warning?

No — `@deprecated` JSDoc only (editor strikethrough); a warning on every run
would add noise to output drivers read, and the chosen option promised no user
config breaks.

### Does `implement` keep any argument positional?

No — all three of its inputs are optional, so the "required stays positional"
rule from `buildTail` leaves none behind; it takes one options object.

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
