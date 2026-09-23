@inmem
Feature: a state's "skills:" field prepends a preamble to its rendered prompt

  A `skills:` value is prose gtd never resolves or validates — it is
  concatenated into the prompt through the `skillsPreamble` var
  (`Edge.ts`'s `renderRest`). Blanking `skillsPreamble` switches the mechanism
  off repo-wide without touching any state's own `skills:` declaration.

  Background:
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        vars:
          workingSkills: "code-review, testing"
          reviewingSkills: "spec-review"
          skillsPreamble: "Load only what your harness has, skip the rest silently: <%= it.skills %>. This state's file format and completion condition outrank anything a skill says. Never turn interactive."
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "start"
                on:
                  "* **": working
              working:
                actor: agent
                skills: "<%= it.vars.workingSkills %>"
                prompt: "do the work"
                on:
                  "* **": reviewing
              reviewing:
                actor: agent
                skills: "<%= it.vars.reviewingSkills %>"
                prompt: "check the work"
                on:
                  "* **": done
              done:
                actor: human
                message: "done"
      """

  Scenario: a state naming a skill renders its prompt with the preamble prepended
    When I run gtd with args "--entry working"
    Then it succeeds
    When I run gtd next
    Then it succeeds
    And stdout contains "Load only what your harness has, skip the rest silently: code-review, testing"
    And stdout contains "do the work"

  Scenario: blanking skillsPreamble renders the same state's prompt unchanged
    Given an environment variable "GTD_SKILLSPREAMBLE" set to ""
    When I run gtd with args "--entry working"
    Then it succeeds
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Load only what your harness has"
    And stdout contains "do the work"

  Scenario: a "GTD_" environment override of one state's own skills var changes only that state's preamble
    Given an environment variable "GTD_WORKINGSKILLS" set to "env-skill"
    When I run gtd with args "--entry working"
    Then it succeeds
    When I run gtd next
    Then it succeeds
    And stdout contains "Load only what your harness has, skip the rest silently: env-skill"
    Given a file "work-output.txt" with:
      """
      the agent's work
      """
    When I run gtd land
    Then it succeeds
    When I run gtd next
    Then it succeeds
    And stdout contains "Load only what your harness has, skip the rest silently: spec-review"
    And stdout does not contain "env-skill"
