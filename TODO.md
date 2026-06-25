Set up a `.gtdrc` file in `/Users/pmelab/Code/gtd/gtd` with values appropriate
for this repository.

- `testCommand`: `npm run test && npm run test:e2e`
- No model overrides — use built-in defaults (`claude-opus-4-8` planning,
  `claude-sonnet-4-8` execution)

## Steps

1. Write `.gtdrc` as YAML with `testCommand: npm run test && npm run test:e2e`
2. Verify `node scripts/gtd.js` picks up the config correctly (no schema errors)

## Resolved

### Should testCommand run unit tests only, e2e only, or both?

**Recommendation:** Both — `npm run test && npm run test:e2e`. Unit tests
(vitest) are fast and catch regressions early; e2e cucumber tests verify the
full CLI pipeline and are required by AGENTS.md. The e2e suite runs a build
first (`pretest:e2e`), so it's slower but essential for the execute gate.
Running both gives the most confidence before committing.

**Answer:** Both — use `npm run test && npm run test:e2e`.

### Should model overrides be set at all, or just rely on the built-in defaults?

**Recommendation:** Keep the built-in defaults (`claude-opus-4-8` planning,
`claude-sonnet-4-8` execution). This is the gtd repo itself — using the same
defaults it ships with is a good dogfood baseline. Override only if you find
planning too slow (downgrade to sonnet) or execution too weak (upgrade to opus).

**Answer:** Agreed — no overrides, rely on built-in defaults.
