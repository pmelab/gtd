# 02 — Document that a diagnostic-free failure never collapses

## Requirements

- **3. Document that a diagnostic-free failure never collapses** — chore; no
  tests.

## Tasks

### 1. Add one sentence to the collapsing paragraph

Paths: `docs/development.md`

- [ ] The collapsing paragraph (around the `same failure as <state>` line) gains
      one sentence: a failing state that prints nothing beyond turbo's own lines
      is always shown in full, never collapsed
- [ ] Prose names no `src/*.ts` module or internal function
- [ ] `format:check` passes on the edited file
