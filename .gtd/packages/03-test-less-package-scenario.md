# 03 — Scenario: test-less package closes via SATISFIED.md

See `.gtd/ARCHITECTURE.md` (Package C, Call Stacks). Consumes the guard as
package 01 leaves it.

## Requirements

**Concern 4 — A package with no `## Tests` whose build writes only
`.gtd/SATISFIED.md` lands and closes out.** Pin it with one `@inmem` scenario in
`tests/integration/features/declared-tests.feature`. **No step definition
changes** — compose existing Given steps. Closing is simulated as
`default-workflow.feature` does: delete the package file, `.gtd/SATISFIED.md`
and `.gtd/ARCHITECTURE.md` (last package), then land.

## Tasks

### 1. Add the test-less package scenario

Paths: `tests/integration/features/declared-tests.feature`

- [ ] New `@inmem` scenario: package file shown in scenario text with no
      `## Tests` section
- [ ] Build writes only `.gtd/SATISFIED.md`, content shown, an issue URL as
      evidence
- [ ] `gtd land` succeeds to `packages.item.health.check`, then to
      `packages.item.closing`
- [ ] Deleting the package file, `.gtd/SATISFIED.md` and `.gtd/ARCHITECTURE.md`
      lands `packages.item.closing → build.quality.correctness.reviewing`
- [ ] Afterwards the package file and `.gtd/SATISFIED.md` do not exist
- [ ] Only existing step definitions used

## Tests

- e2e: `tests/integration/features/declared-tests.feature`
