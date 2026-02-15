# Hierarchical File-Based Configuration

Replace environment variable configuration with a cosmiconfig-based
hierarchical configuration system that merges config from multiple directories.

## Action Items

### Research and Select Library

- [ ] Integrate `cosmiconfig` for RC file loading with Effect
  - Use `cosmiconfig` which supports JSON, YAML, JS, TS config files and
    hierarchical directory searching out of the box
  - Wrap cosmiconfig's async API in Effect using `Effect.tryPromise`
  - The search name should be `gtdrc` so cosmiconfig finds `.gtdrc`,
    `.gtdrc.json`, `.gtdrc.yaml`, `.gtdrc.js`, `gtdrc.config.ts`, etc.
  - Tests: Verify cosmiconfig can locate a `.gtdrc.json` in a temp directory;
    verify it also loads `.gtdrc.yaml` and `.gtdrc.js` formats

### Define Configuration Schema

- [ ] Create an Effect Schema for the config file that mirrors the existing
      `GtdConfig` interface
  - Map current env var names to config keys: `file`, `agent`, `agentPlan`,
    `agentBuild`, `agentLearn`, `testCmd`, `testRetries`, `commitPrompt`,
    `agentInactivityTimeout`, `agentForbiddenTools`
  - All fields must be optional (defaults are applied after merge)
  - `agentForbiddenTools` should be a JSON array instead of a comma-separated
    string
  - Use `@effect/schema` (or `effect/Schema`) for parsing and validation
  - Tests: Validate that a partial config parses correctly; invalid values
    (wrong types, unknown keys) are rejected with clear errors

### Implement Hierarchical Config Loading

- [ ] Implement a config file resolver that searches multiple directories
  - Search order (highest to lowest priority):
    1. `$PWD` and parent directories up to `/` (cosmiconfig's default search)
    2. `$XDG_CONFIG_HOME/gtd/` (e.g. `~/.config/gtd/.gtdrc.json`)
    3. `$XDG_CONFIG_HOME/.gtdrc.json` (e.g. `~/.config/.gtdrc.json`)
    4. `$HOME` (e.g. `~/.gtdrc.json`)
  - Use cosmiconfig's `search()` for the PWD-to-root traversal
  - Manually check XDG and HOME locations using cosmiconfig's `load()` for
    each explicit path
  - Collect all found config objects into an ordered list
  - Tests: Mock filesystem with config files at multiple levels; verify all
    files are discovered in correct priority order

- [ ] Implement shallow merge of config files respecting priority order
  - Higher-priority files override lower-priority ones (shallow merge per
    top-level key since config is flat)
  - Arrays (like `agentForbiddenTools`) should be replaced, not concatenated
  - Apply defaults for any keys not present in any file
  - Tests: Merge configs from `$HOME` and `$PWD` with overlapping and
    non-overlapping keys; verify correct precedence

### Rewrite `GtdConfigService`

- [ ] Replace the `Config.string`/`Config.integer` env var reads in
      `GtdConfigService` with the new file-based loader
  - Keep the same `GtdConfig` interface so downstream consumers are unaffected
  - Environment variables are NOT supported as an override layer — config comes
    solely from config files and defaults
  - The `GtdConfigService.Live` layer should use `@effect/platform` FileSystem
    and Path services as needed
  - Maintain all current default values
  - Tests: Provide a mock filesystem with config files; verify
    `GtdConfigService` produces correct merged config

- [ ] Update `GtdConfigService.Live` layer dependencies in `src/main.ts`
  - Add `PlatformBun` or appropriate filesystem layer if needed
  - Remove any `ConfigProvider` setup for `GTD_` env vars
  - Tests: `bun run test` passes; `bun run dev` starts without errors

### Update Tests

- [ ] Rewrite `Config.test.ts` to use mock filesystem instead of
      `ConfigProvider.fromMap`
  - Test default values when no config file exists
  - Test single file override (`.gtdrc.json`, `.gtdrc.yaml`)
  - Test multi-level merge (home + project directory)
  - Test XDG config locations (`$XDG_CONFIG_HOME/gtd/` and
    `$XDG_CONFIG_HOME/.gtdrc.json`)
  - Test invalid file handling (malformed JSON, wrong types) produces clear
    errors
  - Tests: All test cases pass with `bun vitest run src/services/Config.test.ts`

### Documentation

- [ ] Add a sample `.gtdrc.json` to the README or a new `docs/` file
  - Show all available keys with descriptions and defaults
  - Explain the merge order and supported file formats
  - Mention that env vars are no longer used for configuration
  - Tests: Manual review

## Learnings

- Current config is purely env-var based using Effect's `Config` module with
  `GTD_` prefixed variables
- The `GtdConfig` interface is flat (no nested objects), so shallow merge is
  sufficient
- `agentForbiddenTools` is currently a comma-separated string in env vars but
  should become a proper JSON array
- All consumers access config through the `GtdConfigService` tag, so the change
  is contained to `Config.ts` and `main.ts`
- Environment variables will NOT be supported as an override layer — config is
  file-based only
- Both `$XDG_CONFIG_HOME/gtd/.gtdrc.json` and `$XDG_CONFIG_HOME/.gtdrc.json`
  should be checked as config locations
- All formats supported by cosmiconfig should be accepted (JSON, YAML, JS, TS,
  etc.), not just `.gtdrc.json`
