## Open Questions

### Should testCommand run unit tests only, e2e only, or both?

**Recommendation:** Both — `npm run test && npm run test:e2e`. Unit tests
(vitest) are fast and catch regressions early; e2e cucumber tests verify the
full CLI pipeline and are required by AGENTS.md. The e2e suite runs a build
first (`pretest:e2e`), so it's slower but essential for the execute gate.
Running both gives the most confidence before committing.

<!-- user answers here -->

### Should model overrides be set at all, or just rely on the built-in defaults?

**Recommendation:** Keep the built-in defaults (`claude-opus-4-8` planning,
`claude-sonnet-4-8` execution). This is the gtd repo itself — using the same
defaults it ships with is a good dogfood baseline. Override only if you find
planning too slow (downgrade to sonnet) or execution too weak (upgrade to opus).

<!-- user answers here -->

---

Set up a `.gtdrc` file in `/Users/pmelab/Code/gtd/gtd` with values appropriate
for this repository.

## Steps

1. Decide `testCommand` (see open questions above)
2. Decide model overrides if any
3. Write `.gtdrc` as YAML with the resolved values
4. Verify `node scripts/gtd.js` picks up the config correctly (no schema errors)

## Resolved
