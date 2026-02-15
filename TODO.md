# Documentation & Config UX Fixes

## Action Items

### Fix README Build Section

- [x] Update README.md section "4. Build" to clarify automatic iteration
  - Current text says "Run `gtd` again to build the next item" — replace with
    explanation that `gtd` automatically continues to the next unchecked item
    until all are done, without requiring the user to re-run
  - Tests: Read README.md section 4 and verify it no longer tells the user to
    run `gtd` again between items

### Fix README Learn Section

- [ ] Update README.md section "5. Learn" to clarify that learn is not automatic
  - Current text implies learn phase starts automatically when all items are
    checked — clarify that `gtd` stops after build completes so the human can
    add feedback/learnings to `TODO.md`, then the user runs `gtd` again to
    trigger the learn phase
  - Tests: Read README.md section 5 and verify it describes the manual step
    between build completion and learn

### Create Example Config on Missing Config

- [ ] When no config file is found anywhere, create an example config in the
      current directory
  - In the config resolution flow, detect when all search locations return no
    config
  - Write a default `.gtdrc.json` (or similar) with example/default values to
    `process.cwd()`
  - Include a `$schema` field pointing to the raw schema file on GitHub (e.g.
    `https://raw.githubusercontent.com/<org>/<repo>/main/schema.json`) so
    editors with JSON Schema support provide validation and autocompletion
  - Include a note (printed to stdout and as a comment/field in the file)
    explaining the user can move it to `~/.config/gtd/` or any other supported
    location
  - Tests: Unit test — mock filesystem with no config files, run config
    resolution, verify example config is written to cwd with expected content,
    including a `$schema` URL referencing the GitHub-hosted schema, and a
    location hint. Integration test — verify the CLI prints a message about the
    created config.

## Learnings

- Example config files should include a `$schema` reference to the GitHub-hosted
  JSON schema so users get editor validation out of the box
