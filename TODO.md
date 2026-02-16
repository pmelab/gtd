# GitHub Actions Test Workflow

## Action Items

### CI Workflow Setup

- [ ] Create `.github/workflows/test.yml` workflow file
  - Trigger on `push` (all branches) and `pull_request`
  - Use `ubuntu-latest` runner
  - Steps: checkout, setup Bun (via `oven-sh/setup-bun`), install deps
    (`bun install`), run unit tests (`bun test`)
  - Tests: Push a branch and verify the workflow appears in the Actions tab and
    runs successfully

### Linting & Formatting Checks

- [ ] Add lint and format check steps to the workflow
  - Add `bun run lint` step after tests
  - Add `bun run format:check` step after lint
  - Tests: Introduce a formatting violation on a branch, verify CI fails on the
    format check step
