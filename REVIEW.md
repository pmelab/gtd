# Review: a8da033

<!-- base: a8da033ff78c6746e4e6c88422a06eef0ed09630 -->

## CI: bump test workflow to Node 22

CI now runs the test suite on Node 22 instead of Node 20, matching the new
`engines.node` floor. Verify the workflow still installs and runs correctly on
the bumped runtime.

- [ ] ./.github/workflows/test.yml#16

## Require Node >= 22

`engines.node` raised from `>=20` to `>=22`. Confirm nothing in the codebase
relies on Node 20-only behavior and that the new floor is intentional.

- [ ] ./package.json#12

## Pre-commit hook: husky + lint-staged

Adds an auto-installed pre-commit hook that runs Prettier on staged files. The
`prepare: husky` script installs the hook on `npm install`; `.husky/pre-commit`
runs `npx lint-staged`; the `lint-staged` config formats any staged file via
`prettier --ignore-unknown --write`. `husky` and `lint-staged` added as
devDependencies.

- [ ] ./.husky/pre-commit#1
- [ ] ./package.json#16
- [ ] ./package.json#30
- [ ] ./package.json#44
- [ ] ./package.json#46

## README: document the pre-commit hook

New "Pre-commit hook" subsection under Development explaining the auto-installed
hook and what lint-staged runs. Check the wording matches the actual config.

- [ ] ./README.md#544
