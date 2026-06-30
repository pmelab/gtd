# Fix failing CI and prevent recurrence

## Problem

CI on `main` is red. Root cause: the `Format check` step in
`.github/workflows/test.yml` runs `npm run format:check` (`prettier --check .`),
and 17 tracked files are not prettier-formatted, so the check exits non-zero.

The `Release` workflow (`.github/workflows/release.yml`) calls the test workflow
via `workflow_call` (`uses: ./.github/workflows/test.yml`), so the format
failure cascades and blocks releases too.

Secondary: `test.yml` pins Node `20`, but `semantic-release` requires
`^22.14.0 || >= 24.10.0`. Today this is only an engine warning during
`npm install`, but `release.yml` already runs Node `22`, so the two workflows
are inconsistent.

## Goal

1. Make `npm run format:check` pass so CI is green.
2. Align the test workflow on Node 22 to remove the engine-version warning and
   match the release workflow.
3. Add a pre-commit hook so unformatted code can never reach `main` again.

## Plan

### 1. Format all tracked files

Run the existing format script to fix the 17 offending files:

```bash
npm run format
```

Affected files (per investigation):

- `AGENTS.md`, `example.md`, `README.md`, `SKILL.md`
- `src/Config.test.ts`, `src/Events.test.ts`, `src/Events.ts`, `src/Git.ts`
- `src/Machine.test.ts`, `src/Machine.ts`, `src/Prompt.ts`
- `src/prompts/building.md`, `src/prompts/clean.md`, `src/prompts/decompose.md`,
  `src/prompts/fixing.md`
- `STATES.html`, `STATES.md`

Then verify clean:

```bash
npm run format:check
```

### 2. Bump Node to 22 in the test workflow

In `.github/workflows/test.yml`, change the `setup-node` step:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "22"
```

Also bump the engines floor in `package.json` to match the actual requirement of
the dependency tree:

```json
"engines": {
  "node": ">=22"
}
```

This keeps `test.yml` and `release.yml` (already on `22`) consistent and clears
the `semantic-release` engine warning.

### 3. Add husky + lint-staged pre-commit hook

Auto-format staged files before each commit so unformatted code can't be
committed.

Install dev dependencies:

```bash
npm install --save-dev husky lint-staged
```

Add the `prepare` script and `lint-staged` config to `package.json`:

```json
"scripts": {
  "prepare": "husky"
},
"lint-staged": {
  "*": "prettier --ignore-unknown --write"
}
```

Initialize husky and create the pre-commit hook:

```bash
npx husky init
```

Replace the generated `.husky/pre-commit` contents with:

```sh
npx lint-staged
```

Use `prettier --ignore-unknown --write` (matched against `*`) so the hook
formats exactly the file types prettier supports — mirroring what
`prettier --check .` enforces in CI — and silently skips anything prettier
doesn't understand.

### 4. Verify end-to-end

```bash
npm run format:check   # passes
npm run typecheck
npm run lint
npm test
```

Confirm the hook fires by staging a deliberately mis-formatted file and
committing — lint-staged should format it in place.

## Notes / follow-up

- Update `README.md` to document the pre-commit hook setup (the `prepare` script
  runs `husky` automatically after `npm install`, so contributors get the hook
  on a fresh clone with no extra steps).
- The formatting commit will touch many files but is mechanical; keep it
  separate from the workflow/hook changes for a clean history.

no open questions — run gtd to plan
