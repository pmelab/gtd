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
  - Change step order to: format check → typechecks → lint → unit tests → e2e
    tests
  - Fast, static checks run first so PRs fail quickly without waiting for slow
    test suites
  - Add a `bun run typecheck` step (e.g., `tsc --noEmit` or equivalent) between
    format check and lint
  - Tests: Verify the workflow file has steps in the correct order. Introduce a
    type error on a branch and confirm CI fails on the typecheck step before
    reaching unit/e2e tests

## Learnings

- Order CI steps from fastest/cheapest to slowest/most expensive (format →
  typechecks → lint → unit → e2e) so failures surface early and save runner time
