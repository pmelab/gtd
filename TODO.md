# Hierarchical File-Based Configuration

Replace environment variable configuration with a `.gtdrc.json` file-based
hierarchical configuration system that merges config from multiple directories.

## Action Items

### Research and Select Library

- [ ] Evaluate `cosmiconfig` or similar RC file loading libraries for Effect
      compatibility
  - Check if there's an Effect-native config file loader, otherwise use
    `cosmiconfig` which supports JSON, YAML, JS config files and hierarchical
    directory searching
  - If no good library exists, implement a simple loader using
    `@effect/platform` FileSystem
  - Tests: Verify chosen library can locate `.gtdrc.json` in parent directories

### Define Configuration Schema

- [ ] Create a JSON schema / Zod schema for `.gtdrc.json` that mirrors the
      existing `GtdConfig` interface
  - Map current env var names to JSON keys: `file`, `agent`, `agentPlan`,
    `agentBuild`, `agentLearn`, `testCmd`, `testRetries`, `commitPrompt`,
    `agentInactivityTimeout`, `agentForbiddenTools`
  - All fields should be optional in the file (defaults are applied after merge)
  - `agentForbiddenTools` should be a JSON array instead of a comma-separated
    string
  - Tests: Validate that a partial `.gtdrc.json` parses correctly; invalid
    values are rejected

### Implement Hierarchical Config Loading

- [ ] Implement a config file resolver that searches for `.gtdrc.json` in
      priority order
  - Search order (highest to lowest priority): `$PWD`, parent directories up to
    `/`, `$XDG_CONFIG_HOME/gtd/`, `$HOME`
  - Use `@effect/platform` FileSystem to read files
  - Collect all found config files into an ordered list
  - Tests: Mock filesystem with `.gtdrc.json` at multiple levels; verify all
    files are discovered in correct order

- [ ] Implement deep merge of config files respecting priority order
  - Higher-priority files override lower-priority ones (shallow merge per
    top-level key is sufficient since config is flat)
  - Arrays (like `agentForbiddenTools`) should be replaced, not concatenated
  - Apply defaults for any keys not present in any file
  - Tests: Merge configs from `$HOME` and `$PWD` with overlapping and
    non-overlapping keys; verify correct precedence

### Rewrite `GtdConfigService`

- [ ] Replace the `Config.string`/`Config.integer` env var reads in
      `GtdConfigService` with the new file-based loader
  - Keep the same `GtdConfig` interface so downstream consumers are unaffected
  - The `GtdConfigService.Live` layer should use `@effect/platform` FileSystem
    and Path services
  - Maintain all current default values
  - Tests: Provide a mock filesystem with `.gtdrc.json` files; verify
    `GtdConfigService` produces correct merged config

- [ ] Update `GtdConfigService.Live` layer dependencies in `src/main.ts`
  - Add `PlatformBun` or appropriate filesystem layer if needed
  - Tests: `bun run test` passes; `bun run dev` starts without errors

### Update Tests

- [ ] Rewrite `Config.test.ts` to use mock filesystem instead of
      `ConfigProvider.fromMap`
  - Test default values when no `.gtdrc.json` exists
  - Test single file override
  - Test multi-level merge (home + project directory)
  - Test invalid JSON handling (should produce clear error)
  - Tests: All test cases pass with `bun vitest run src/services/Config.test.ts`

### Documentation

- [ ] Add a sample `.gtdrc.json` to the README or a new `docs/` file
  - Show all available keys with descriptions and defaults
  - Explain the merge order
  - Tests: Manual review

## Open Questions

- Should environment variables still work as a final override layer on top of
  file-based config? This would preserve backwards compatibility.
  > no
- Should `$XDG_CONFIG_HOME/gtd/.gtdrc.json` be supported, or just
  `$XDG_CONFIG_HOME/.gtdrc.json`?
  > both
- Should the config file name be `.gtdrc.json` only, or also support
  `.gtdrc.yaml`, `.gtdrc.js` etc. via cosmiconfig?
  > everything that cosmiconfig supports

## Learnings

- Current config is purely env-var based using Effect's `Config` module with
  `GTD_` prefixed variables
- The `GtdConfig` interface is flat (no nested objects), so shallow merge is
  sufficient
- `agentForbiddenTools` is currently a comma-separated string in env vars but
  should become a proper JSON array
- All consumers access config through the `GtdConfigService` tag, so the change
  is contained to `Config.ts` and `main.ts`
