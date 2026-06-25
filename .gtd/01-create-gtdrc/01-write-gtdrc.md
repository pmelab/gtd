## Description

Write a `.gtdrc` YAML file at the repo root to configure the `testCommand` for this repository.

## Acceptance Criteria

- [ ] `.gtdrc` exists at `/Users/pmelab/Code/gtd/gtd/.gtdrc`
- [ ] File contains exactly:
  ```yaml
  testCommand: npm run test && npm run test:e2e
  ```
- [ ] No model overrides are present
- [ ] `node scripts/gtd.js` picks up the config with no schema errors (command must not fail)

## File to Write

**Path:** `/Users/pmelab/Code/gtd/gtd/.gtdrc`

**Content:**
```yaml
testCommand: npm run test && npm run test:e2e
```

## Verification

Run `node scripts/gtd.js` and confirm it does not exit with a schema/config error.
