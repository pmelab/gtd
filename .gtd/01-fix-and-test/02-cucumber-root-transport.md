# Task: Cucumber coverage for a root `gtd: transport` commit

Add a composable `Given` step and a scenario proving that a `gtd: transport`
commit which is the repo's **root commit** fails fast with a clear error
instead of looping to `MAX_EDGE_HOPS`.

## Why a new step

`createTestProject()` always seeds a `chore: initial commit`, so the existing
`"a commit {string} that adds {string} with:"` step can never make
`gtd: transport` the root. We need a step that creates the transport commit as
the **very first** commit in a fresh, empty repo.

## 1. New `Given` step in `common.steps.ts`

Add a generic, composable step (one step = one commit; file content visible in
the scenario text), mirroring the existing
`"a commit {string} that adds {string} with:"` step but `git init`-ing a fresh
empty repo first so the commit is the root:

```gherkin
Given a root commit "gtd: transport" that adds "src/wip.ts" with:
  """
  export const wip = () => "carried across machines"
  """
```

Implementation (inline in the step definition — do not hide setup behind a
helper, per AGENTS.md):

- `mkdtempSync` a fresh dir, `git init -q`, set the same config as
  `createTestProject` (`user.name`, `user.email`, `commit.gpgsign=false`).
- Write `path` with the given content, `git add <path>`, `git commit -q -m
  <message>`.
- Set `this.repoDir` to the new dir. This step **replaces** "a test project" —
  the scenario uses it directly so there is no preceding `chore: initial
  commit`.

Match the indentation, imports (`mkdtempSync`, `tmpdir`), and `execFileSync`
patterns already present in `common.steps.ts` /
`tests/integration/helpers/project-setup.ts`. Note `common.steps.ts` currently
imports only `writeFileSync, mkdirSync, readFileSync` from `node:fs` and does
not import `tmpdir` — add `mkdtempSync` to the `node:fs` import and a
`import { tmpdir } from "node:os"` line.

## 2. New scenario in `transport.feature`

```gherkin
Scenario: A gtd: transport HEAD that is the repo root commit fails clearly
  Given a root commit "gtd: transport" that adds "src/wip.ts" with:
    """
    export const wip = () => "carried across machines"
    """
  When I run gtd
  Then it fails
  And stderr contains "root commit"
```

Use the existing `it fails` and `stderr contains {string}` assertions — no new
assertion steps.

## Files

- Modify: `tests/integration/support/steps/common.steps.ts` (add the `Given`
  step only)
- Modify: `tests/integration/features/transport.feature` (add the scenario
  only)

## Constraints

- Keep the `Given` step small, composable, and generic; expose the file content
  in the scenario text (AGENTS.md testing rules).
- Inline the setup into the step definition; one step maps to one commit.
- Do not modify the existing transport scenario or any existing step.
- Run `npm run test:e2e` before considering this done. This depends on the
  paired Git fix landing in the same package, which makes the scenario pass.

## Acceptance criteria

- [ ] A new `Given` step `"a root commit {string} that adds {string} with:"`
      exists in `common.steps.ts`, creating a fresh empty repo and committing
      the file as the root commit, then setting `this.repoDir`.
- [ ] The step inlines its own `git init` + config + add + commit (no shared
      helper) and exposes file content via the scenario docstring.
- [ ] The new scenario in `transport.feature` runs gtd, asserts `it fails`, and
      asserts `stderr contains "root commit"`.
- [ ] The existing transport scenario and all existing steps are untouched.
- [ ] `npm run test:e2e` passes (both transport scenarios green).
