@inmem
Feature: "it.vars" — the three-layer merged variable map every template sees

  Pins the merged `it.vars` map (see `src/Edge.ts`'s `resolveVars` and
  `docs/configuration.md`'s "Variables" section): a workflow's own declared
  `vars:` defaults, overridden by a top-level `.gtdrc` `vars:` key, overridden
  by a `GTD_VAR_<name>` environment variable — later wins, and `model:` is
  now rendered through the same `it.vars`-carrying template context as
  content.

  Scenario: a workflow-declared "vars:" value renders into a prompt via `it.vars`
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
            prompt: "Assigned reviewer: <%= it.vars.reviewer %>"
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

  Scenario: a top-level ".gtdrc" "vars:" key overrides the workflow's own declared default
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
            prompt: "Assigned reviewer: <%= it.vars.reviewer %>"
            on:
              "* **": done
          done:
            commit: "chore: done"
      vars:
        reviewer: bob
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "Assigned reviewer: bob"
    And stdout does not contain "alice"

  Scenario: a "GTD_VAR_" environment variable beats both the workflow default and the ".gtdrc" value
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
            prompt: "Assigned reviewer: <%= it.vars.reviewer %>"
            on:
              "* **": done
          done:
            commit: "chore: done"
      vars:
        reviewer: bob
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And an environment variable "GTD_VAR_reviewer" set to "carol"
    When I run gtd next
    Then it succeeds
    And stdout contains "Assigned reviewer: carol"
    And stdout does not contain "alice"
    And stdout does not contain "bob"

  Scenario: an environment variable may introduce a name neither config layer declared
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "start"
            on:
              "* **": working
          working:
            actor: agent
            prompt: "Brand new: <%= it.vars.brandNew %>"
            on:
              "* **": done
          done:
            commit: "chore: done"
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And an environment variable "GTD_VAR_brandNew" set to "hello"
    When I run gtd next
    Then it succeeds
    And stdout contains "Brand new: hello"

  Scenario: the bundled default workflow's "checking" script renders "npm test" from its own declared default
    Given a test project
    And a commit "gtd(agent): checking" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "npm test > .gtd/.check-output"

  Scenario: the bundled default workflow's "checking" script renders the overridden testCommand
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      vars:
        testCommand: echo overridden
      """
    And a commit "gtd(agent): checking" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "echo overridden"
    And stdout does not contain "npm test >"

  Scenario: a "GTD_VAR_testCommand" environment variable overrides the bundled default's own testCommand
    Given a test project
    And a commit "gtd(agent): checking" that adds "src/thing.ts" with:
      """
      export const thing = 1
      """
    And an environment variable "GTD_VAR_testCommand" set to "echo env-wins"
    When I run gtd next
    Then it succeeds
    And stdout contains "echo env-wins"
    And stdout does not contain "npm test >"

  Scenario: a state's "model:" resolves an "it.vars" reference in "gtd next --json"
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        vars:
          reviewModel: opus
        states:
          idle:
            actor: human
            initial: true
            message: "start"
            on:
              "* **": working
          working:
            actor: agent
            model: "<%= it.vars.reviewModel %>"
            prompt: "do the work"
            on:
              "* **": done
          done:
            commit: "chore: done"
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"model\":\"opus\""

  Scenario: a templated "model:" render failure fails "gtd next" the same way a content render failure would
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        states:
          idle:
            actor: human
            initial: true
            message: "start"
            on:
              "* **": working
          working:
            actor: agent
            model: "<%= it.vars.nope.deeper %>"
            prompt: "do the work"
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
    Then it fails
