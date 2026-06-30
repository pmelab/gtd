# Review: a8da033

<!-- base: a8da033ff78c6746e4e6c88422a06eef0ed09630 -->

## File restore after gtd machine bug

The gtd machine's Close Package edge action accidentally emptied `SKILL.md`,
`STATES.html`, `STATES.md`, and `example.md`, replaced `README.md` with a stub,
and left behind empty ghost files (`src_prompts_*.md`). Commit `52e8515`
restores all content from the pre-damage commit `d1f91d0`, removes the ghost
files, and re-applies the pre-commit docs in the right place. Confirm the
restored files match their pre-damage state.

- [ ] ./SKILL.md
- [ ] ./STATES.md
- [ ] ./STATES.html
- [ ] ./example.md
- [ ] ./README.md

## Node version bump (20 → 22)

Minimum supported Node moves from 20 to 22, in both CI and the package engines
field. Note `npm run dev` already required Node 22.6+ for native TypeScript
type-stripping, so this aligns the floor with what dev mode needs.

- [ ] ./.github/workflows/test.yml#16
- [ ] ./package.json#12

## Pre-commit hook (husky + lint-staged)

Adds an auto-installed pre-commit hook. `prepare: husky` wires it up on
`npm install`; `.husky/pre-commit` runs `npx lint-staged`; the `lint-staged`
config runs `prettier --ignore-unknown --write` on staged files. This mirrors
the `prettier --check .` enforced in CI so commits stay formatted without a
manual pass.

- [ ] ./.husky/pre-commit#1
- [ ] ./package.json#16
- [ ] ./package.json#30
- [ ] ./package.json#44

## README pre-commit documentation

New "Pre-commit hook" section under Development documenting the auto-installed
hook and its relationship to the CI format check.

- [ ] ./README.md#544
