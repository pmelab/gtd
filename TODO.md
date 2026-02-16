# Move Config File Creation to `init` Subcommand

## Action Items

### Remove Auto-Creation from Config Service

- [ ] Remove `createExampleConfig` call from `GtdConfigService.make` in
      `src/services/Config.ts`
  - Delete the `if (configs.length === 0)` block that calls
    `createExampleConfig` and logs the message
  - When no config is found, just return defaults silently (already handled by
    `mergeConfigs([])`)
  - Tests: Update `Config.test.ts` — remove the test "creates example
    .gtdrc.json in cwd when no config files exist" and "prints a message about
    the created example config"; verify "does not create example config when a
    config already exists" still passes; verify "provides all default values
    when no config files exist" still passes without side effects (no file
    written)

### Add `init` Subcommand

- [ ] Create `src/commands/init.ts` with an `initCommand` effect

  - Always create `.gtdrc.json` in `process.cwd()` (no `--path` option)
  - Call `createExampleConfig(process.cwd())` from `ConfigResolver.ts`
  - On success, print the result message via `Console.log`
  - On `null` result (write failure), print an error message and exit with
    non-zero code
  - If `.gtdrc.json` already exists in cwd, print a message saying config
    already exists and skip creation
  - Tests: Create `src/commands/init.test.ts` — test that it creates
    `.gtdrc.json` with `$schema` in a temp dir; test that it prints the success
    message; test that it skips when config already exists; test error handling
    when directory is not writable

- [ ] Add `--global` flag to `init` subcommand

  - When `--global` is passed, create config at `~/.config/gtd/.gtdrc.json`
    instead of cwd
  - Use `$XDG_CONFIG_HOME/gtd/` if `XDG_CONFIG_HOME` is set, otherwise
    `~/.config/gtd/`
  - Create the directory if it doesn't exist (`mkdir -p` equivalent)
  - If config already exists at the global path, print a message and skip
  - Reuse `createExampleConfig` by passing the resolved global directory path
  - Tests: Test that `--global` creates `.gtdrc.json` in the XDG config dir;
    test that it creates the directory when missing; test that it respects
    `XDG_CONFIG_HOME` env var; test that it skips when global config already
    exists

- [ ] Register the `init` subcommand in `src/cli.ts`
  - Use `Command.make("init", ...)` and add it as a subcommand of the root `gtd`
    command via `Command.withSubcommands`
  - Add `--global` as a boolean `Options.boolean("global")` flag
  - The `init` command should not require `AgentService` or `GitService` — only
    needs filesystem access
  - Tests: Verify `gtd init` triggers config creation in an integration test;
    verify `gtd init --global` creates config in global dir; verify the main
    `gtd` command still works without init

### Clean Up Tests

- [ ] Remove or update `ConfigResolver.test.ts` tests that depend on
      auto-creation behavior
  - The `createExampleConfig` unit tests in `ConfigResolver.test.ts` should
    remain — the function still exists, it's just no longer called automatically
  - Tests: Run full test suite (`bun vitest run`) — all tests pass with no
    regressions

## Learnings

- Prefer `process.cwd()` over a `--path` option for config creation — simpler
  UX, users can just `cd` to the target directory
