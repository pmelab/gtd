# Document the pre-commit hook in README

## Description

Document the husky + lint-staged pre-commit hook setup in `README.md` so
contributors understand it. The `prepare` script runs `husky` automatically
after `npm install`, so the hook is installed on a fresh clone with no extra
steps — make this clear.

## Content to add

A short section (e.g. under contributing/development setup) covering:

- A pre-commit hook auto-formats staged files via lint-staged + Prettier.
- It is installed automatically by the `prepare` script on `npm install` — no
  manual setup needed on a fresh clone.
- The hook runs `prettier --ignore-unknown --write` on staged files, mirroring
  the `npm run format:check` (`prettier --check .`) step enforced in CI.

## Acceptance criteria

- [ ] `README.md` describes the pre-commit hook and that it auto-installs via
      `prepare` on `npm install`
- [ ] Mentions it mirrors the CI `format:check` step
- [ ] `npm run format:check` still passes (README itself stays Prettier-clean)

## Relevant file paths

- `README.md`

## Constraints

- Docs only — no code, workflow, or `package.json` changes.
- Keep the README Prettier-formatted.
- Leave all changes uncommitted.
