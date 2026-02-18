# Enable Sandboxing by Default

## Action Items

### Change Default Value

- [x] Change `sandboxEnabled` default from `false` to `true` in
      `ConfigResolver.ts`
  - In `src/services/ConfigResolver.ts`, change `sandboxEnabled: false` to
    `sandboxEnabled: true` in the `defaults` object (line 149)
  - Tests: existing config tests should reflect the new default;
    `ConfigResolver.test.ts` line 260 expects `false` — update to expect `true`

### Update Agent Resolution Fallback

- [ ] Change the fallback default in `resolveAgent` string overload from `false`
      to `true`
  - In `src/services/Agent.ts`, the string argument path (line 107) hardcodes
    `sandboxEnabled: false` — change to `true`
  - The `sandboxEnabled: agentIdOrOptions.sandboxEnabled ?? false` fallback
    (line 108) should also change to `?? true`
  - Tests: `Agent.test.ts` "string argument behaves as sandboxEnabled=false"
    test needs updating — string argument should now behave as
    `sandboxEnabled=true`

### Update Tests

- [ ] Update `ConfigResolver.test.ts` default assertion
  - Change `expect(result.sandboxEnabled).toBe(false)` to `toBe(true)`
    (line 260)
  - Tests: run `bun test src/services/ConfigResolver.test.ts`
- [ ] Update `Agent.test.ts` sandbox resolution tests
  - Update "string argument behaves as sandboxEnabled=false" test description
    and assertion — string argument now implies sandbox enabled
  - Update `AgentService.Live` test config to use `sandboxEnabled: true`
    (line 135)
  - Tests: run `bun test src/services/Agent.test.ts`
- [ ] Update test helpers default config
  - In `src/test-helpers.ts` line 15, change `sandboxEnabled: false` to
    `sandboxEnabled: true`
  - Tests: run full test suite to verify no regressions

### Update Documentation

- [ ] Update README/docs to reflect sandbox-on-by-default behavior
  - Users who want to opt out should set `sandboxEnabled: false` in their config
  - Update `EXAMPLE_CONFIG` in `ConfigResolver.ts` to include
    `sandboxEnabled: true` to make the default explicit
  - Tests: run `bun test src/readme.test.ts`

## Learnings

- Prefer secure-by-default settings — sandbox should be enabled by default
  following least-privilege principles, with users explicitly opting out rather
  than opting in
- When changing a default value, update all three layers: the defaults object,
  any hardcoded fallbacks in function signatures, and all test assertions that
  reference the old default
