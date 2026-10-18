# 01 — Repo-config test derives its workflow list

## Requirement

### 1. The repo-config test derives its workflow list (TECHNICAL)

`tests/tooling/package-exports.test.ts` › "this repository's config" › "loads,
running the shipped workflows" pins `workflowNames` to the literal
`["cleanup", "feature", "fix", "review", "rollout"]`. Adding or removing a
workflow export in `gtd.config.ts` reds `test:unit` in every flag state (issue
#372 follow-up a).

- Derive the expected list from what `gtd.config.ts` actually exports, so a
  config change updates one place
- Keep the test's real guard: the config loads, the default workflow is
  `feature`, every exported workflow is startable
- Green on its own: `npm run test:unit`

Interface and call stack: `.gtd/ARCHITECTURE.md` › Interfaces › Concern 1.

## Tasks

### Task 1: Replace the literal list with names read from `gtd.config.ts`

Read `gtd.config.ts` source in the test, match every
`/^export const (\w+) = \w+\(/gm`, sort, compare with `config.workflowNames`.
`config` (object literal) and re-exported helpers never match. A workflow
exported another shape (arrow function, `export { x } from`) is missed and reds
the test with a diff naming it — loud, never silent.

- [ ] Literal `["cleanup", "feature", "fix", "review", "rollout"]` gone from
      `tests/tooling/package-exports.test.ts`
- [ ] `expect(config.workflowNames).toEqual(declared)` where `declared` is the
      sorted regex-matched names from `gtd.config.ts`
- [ ] Adding or removing a `export const <name> = <call>(` workflow in
      `gtd.config.ts` needs no test edit
- [ ] No vitest import of `gtd.config.ts` itself — config still loads via
      `ConfigService.load` (no alias resolves `@pmelab/gtd/workflows` to source)

Paths: `tests/tooling/package-exports.test.ts`, `gtd.config.ts` (read only)

### Task 2: Keep the startable guard per declared name

- [ ] `expect(config.defaultWorkflow.name).toBe("feature")` kept
- [ ] For every declared name, `config.workflowNamed(name)?.def.initial` is
      defined
- [ ] `npm run test:unit` green

Paths: `tests/tooling/package-exports.test.ts`

## Tests

- unit: `tests/tooling/package-exports.test.ts`
