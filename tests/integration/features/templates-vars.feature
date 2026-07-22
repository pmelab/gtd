@inmem
Feature: The "vars:" passthrough reaches templates as `it.config`

  Pins the `PatternConfig.compileWorkflowConfig` "config" passthrough (see
  src/PatternConfig.ts's module docstring): a `workflow:` key's sibling
  `vars:` sub-key is passed through verbatim, unvalidated, as the `config`
  template variable every script/prompt/message/commit template can read via
  `it.config`.

  Scenario: a "vars:" value renders into a prompt via `it.config`
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        vars:
          reviewer: alice
        states:
          idle:
            actor: human
            initial: true
            message: "start"
            on:
              "* **": working
          working:
            actor: agent
            prompt: "Assigned reviewer: <%= it.config.reviewer %>"
            on:
              "* **": done
          done:
            commit: "chore: done"
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Assigned reviewer: alice"
