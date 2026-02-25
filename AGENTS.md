## Testing

- create cucumber.js scenarios for each new feature
- use composable "Given" steps (small, reusable steps) instead of one-off setup
  steps
- make Given steps generic and expose actual file content/changes in scenario
  text — don't hide setup behind abstract step names
- inline setup logic into step definitions rather than chaining helpers; each
  step maps to one commit

## Architecture

### Mode Flags (Effect Dependency Graph)

- Follow the `QuietMode` pattern (Context tag + `static layer`) for any new
  boolean mode flags that need to flow through the Effect dependency graph

### Stdout / Newline Handling

- `ensureNewline` only flushes a `\n` when the state it tracks is `dirty`; any
  code that writes to stdout directly (bypassing the handler) must also update
  that dirty state, or the next line will be appended without a separator
- When adding a `rendererDirty` guard, verify it is read inside every exit path
  of the renderer (`succeed`, `fail`, `setText`, etc.) — missing a single call
  site silently reintroduces the missing-newline bug for that transition

## CLI Design

- Keep CLI flags orthogonal: `--verbose` and `--debug` must never imply each
  other; each flag controls exactly one concern so users can combine them freely

## Event Handler

- Gate every user-visible stdout write inside `createEventHandler` behind the
  `verbose` flag — both `ThinkingDelta` and `ToolStart` (and any future event
  type) must be suppressed together; a partially-silent handler leaks noise
