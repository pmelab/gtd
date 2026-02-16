# GitHub Actions Test Workflow

## Action Items

### CI Workflow Setup

- [x] Create `.github/workflows/test.yml` workflow file
  - Trigger on `push` (all branches) and `pull_request`
  - Use `ubuntu-latest` runner
  - Steps: checkout, setup Bun (via `oven-sh/setup-bun`), install deps
    (`bun install`), run unit tests (`bun test`), run e2e tests
    (`bun run test:e2e`)
  - Tests: Push a branch and verify the workflow appears in the Actions tab and
    runs successfully, confirming both unit and e2e test steps pass

### Linting & Formatting Checks

- [x] Add lint and format check steps to the workflow
  - Add `bun run lint` step after tests
  - Add `bun run format:check` step after lint
  - Tests: Introduce a formatting violation on a branch, verify CI fails on the
    format check step

### CI Step Ordering

- [x] Reorder workflow steps to fail early on cheap checks
  - Change step order to: typecheck → lint → format check → unit tests → e2e
    tests
  - Rationale: type errors and lint issues are the most common failures and
    cheapest to detect; format check follows since it's also fast; slow test
    suites run last
  - Move the `Typecheck` step before `Lint`, and move `Format check` after
    `Lint` in `.github/workflows/test.yml`
  - Tests: Verify the workflow file has steps in the correct order (`typecheck`,
    `lint`, `format:check`, `test`, `test:e2e`). Introduce a type error on a
    branch and confirm CI fails on the typecheck step before reaching lint or
    tests

## Learnings

- Order CI steps from fastest/cheapest to slowest/most expensive so failures
  surface early and save runner time — prefer: typecheck → lint → format → unit
  → e2e
