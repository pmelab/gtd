Feature: a leftover .gtdrc fails loudly

  gtd no longer reads the `.gtdrc` family: repository settings live in
  `gtd.config.ts`. A leftover rc file — in the repository, above it, or in
  your home directory — would otherwise be silently ignored, so every command
  that loads the config refuses it, naming the file and where each of its keys
  went. It is a config error, so it exits 1.

  @inmem
  Scenario: a repository's .gtdrc.json is refused, naming the file and each key's new home
    Given a test project
    And the workflow gtd install scaffolds
    And a gtd config file at ".gtdrc.json" with:
      """
      { "env": { "testCommand": "npm test" } }
      """
    When I run gtd with args "next"
    Then the exit code is 1
    And stdout is empty
    And stderr contains ".gtdrc.json: no longer read — delete it"
    And stderr contains "vars    → an option of the workflow factory in gtd.config.ts, or its `defaults` export"
    And stderr contains "env     → an option of the workflow factory in gtd.config.ts, or its `envDefaults` export"
    And stderr contains "judge   → ~/.config/gtd/judge.json, or GTD_JUDGE_PROVIDER / GTD_JUDGE_MODEL"
    And stderr contains "modes, ui, skills, access → the `config` export of gtd.config.ts (`defineConfig`)"
    And stderr contains "docs/configuration.md#migrating-from-gtdrc"

  @inmem
  Scenario: a YAML .gtdrc is refused without being parsed
    Given a test project
    And the workflow gtd install scaffolds
    And a gtd config file at ".gtdrc" with:
      """
      modes: [this is: not valid
      """
    When I run gtd with args "next"
    Then the exit code is 1
    And stderr contains ".gtdrc: no longer read — delete it"

  @inmem
  Scenario: deleting the rc file is the whole fix
    Given a test project
    And the workflow gtd install scaffolds
    And a gtd config file at ".gtdrc.json" with:
      """
      {}
      """
    And I run gtd with args "next"
    And the exit code is 1
    When the file ".gtdrc.json" is deleted
    And I run gtd with args "next"
    Then it succeeds

  @live
  Scenario: an ancestor directory's .gtdrc.json is refused too
    Given a test project nested under a directory with a file ".gtdrc.json" containing:
      """
      { "$schema": "https://cdn.jsdelivr.net/npm/@pmelab/gtd/schema.json" }
      """
    And the workflow gtd install scaffolds
    When I run gtd with args "next"
    Then the exit code is 1
    And stderr contains "/.gtdrc.json: no longer read — delete it"

  @inmem
  Scenario: gtd judge run refuses a leftover rc file before reading the judgment
    Given a test project
    And a gtd config file at ".gtdrc.yaml" with:
      """
      judge:
        provider: fixed
      """
    When I run gtd with args "judge run"
    Then the exit code is 1
    And stdout is empty
    And stderr contains ".gtdrc.yaml: no longer read — delete it"
