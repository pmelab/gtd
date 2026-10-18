# 02 — Refactor fix scopes keep the write limit, and the docs match

## Requirements

**Concern 2.** `refactor.build.review.fix.nits` and
`refactor.build.review.fix.risks` get `{}` in the access table. **`{}` reopens
all writes, so a refactor nit or risk fix can edit any file**, past the
strays-plus-`.gtd/**` limit. Both scopes get strays plus `.gtd/**` as `write`,
set at run time by the refactor's own `scope()` option; the static `{}` entries
go. `refactor.build.review` (`.gtd/REVIEW.md`) and `refactor.build.review.defer`
(`.gtd/TODO.md`) stay.

**Concern 3.** `docs/configuration.md` access and scope lists match the code:
add the refactor review rows to "Bundled defaults", drop the non-existent
`refactor.build.review.health.*`, check every `refactor.build.*` name.

See `.gtd/ARCHITECTURE.md` — `BuildTailOptions.fixAccess`, `fixNits / fixRisks`,
`access`, call stack 2+3, merged concerns 2+3.

## Tasks

### 1. Drop the static `{}` entries

Paths: `src/workflows/shared/access.ts`, `src/workflows/shared/access.test.ts`

- [ ] `refactor.build.review.fix.nits` and `refactor.build.review.fix.risks`
      removed from the bundled export
- [ ] `refactor.build.review` and `refactor.build.review.defer` unchanged
- [ ] Unit test pins both facts

### 2. `fixNits` / `fixRisks` take `access`

Paths: `src/workflows/feature/steps.ts`, `src/workflows/shared/steps.ts`,
`src/workflows/feature/review.test.ts`

- [ ] With `access`, the turn runs as
      `scope({ name: "review.fix.nits", access }, () => agentWithSkills("fixing", …))`
      (`review.fix.risks` likewise)
- [ ] **Full step name stays `refactor.build.review.fix.nits.fixing` — public
      API, unchanged**
- [ ] Without `access`, the call is byte for byte today's
- [ ] A `config.access` entry on the fix scope still outranks the scope option

### 3. `BuildTailOptions.fixAccess` and `reviewedRefactor`

Paths: `src/workflows/feature/review.ts`,
`src/workflows/feature/review.test.ts`, `src/workflows/feature/refactor.ts`,
`src/workflows/feature/refactor.test.ts`

- [ ] `fixAccess?: ScopeAccess` on `BuildTailOptions`, reaching both fix turns;
      absent, both resolve as today
- [ ] `reviewedRefactor` passes `fixAccess = { write: [...strays, ".gtd/**"] }`
- [ ] Unit: with `access`, step names are still `review.fix.nits.fixing` /
      `review.fix.risks.fixing` under the enclosing scopes
- [ ] Unit: refactor nit-fix turn's resolved write access is the strays plus
      `.gtd/**`

### 4. Scenario

Paths: `src/workflows/feature/refactor-review.feature`

- [ ] At `refactor.build.review.fix.nits.fixing`, `gtd next --json=access.write`
      lists the strays and `.gtd/**`; a nit fix writing a non-stray is refused
      at landing

### 5. Docs

Paths: `docs/configuration.md`

- [ ] "Bundled defaults" gains `refactor.build.review`,
      `refactor.build.review.defer` and both fix scopes (strays plus `.gtd/**`,
      set at run time; a `config.access` entry on the fix scope outranks it, a
      `config.access.refactor` entry does not reach it)
- [ ] `refactor.build.review.health.*` dropped from the never-guarded rests
- [ ] Every `refactor.build.*` name checked against the scopes the flow opens

## Tests

- unit: `src/workflows/shared/access.test.ts`
- unit: `src/workflows/feature/review.test.ts`
- unit: `src/workflows/feature/refactor.test.ts`
- e2e: `src/workflows/feature/refactor-review.feature`
