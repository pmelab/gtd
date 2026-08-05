@inmem
Feature: "on" pattern keys are Eta templates over "it.vars"

  Pins that an `on` pattern key is rendered against `it.vars` at the edge
  (`src/Edge.ts`'s `renderOnEdges`) before the pure engine ever matches it —
  see `STATES.md` §3 and `docs/configuration.md`'s "on:" section. Repointing a
  path var (a top-level `.gtdrc` `vars:` key, or a `GTD_` override) reroutes
  a templated `on` pattern along with any `file:`/content template reading or
  writing the same path, instead of desyncing the machine.

  Scenario: a top-level "vars:" repoint reroutes a templated "on" pattern to the new path
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        vars:
          outFile: OUT.md
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
                prompt: "do the work"
                on:
                  "A <%= it.vars.outFile %>": captured
                  "* **": working
              captured:
                actor: human
                message: "done"
      vars:
        outFile: RENAMED.md
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "RENAMED.md" with:
      """
      the renamed output
      """
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): working → captured"

  Scenario: authoring at the OLD literal path no longer matches once the var is repointed
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        vars:
          outFile: OUT.md
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
                prompt: "do the work"
                on:
                  "A <%= it.vars.outFile %>": captured
              captured:
                actor: human
                message: "done"
      vars:
        outFile: RENAMED.md
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "OUT.md" with:
      """
      written at the stale default path
      """
    When I run gtd step agent
    Then it fails
    And stderr contains "RENAMED.md"

  Scenario: a "GTD_" override reroutes a templated "on" pattern the same way
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        vars:
          outFile: OUT.md
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
                prompt: "do the work"
                on:
                  "A <%= it.vars.outFile %>": captured
                  "* **": working
              captured:
                actor: human
                message: "done"
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "ENV_OUT.md" with:
      """
      the env-repointed output
      """
    And an environment variable "GTD_OUTFILE" set to "ENV_OUT.md"
    When I run gtd step agent
    Then it succeeds
    And the last commit subject is "gtd(agent): working → captured"

  Scenario: "gtd status --json" reports the pending change against the RENDERED pattern
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        vars:
          outFile: OUT.md
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
                prompt: "do the work"
                on:
                  "A <%= it.vars.outFile %>": captured
                  "* **": working
              captured:
                actor: human
                message: "done"
      vars:
        outFile: RENAMED.md
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "RENAMED.md" with:
      """
      the renamed output
      """
    When I run gtd status with "--json"
    Then it succeeds
    And stdout contains "\"pattern\":\"A RENAMED.md\""
    And stdout contains "\"pattern\":\"A RENAMED.md\",\"target\":\"captured\""
    And stdout does not contain "it.vars.outFile"
