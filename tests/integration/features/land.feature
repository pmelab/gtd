Feature: gtd land — the one landing verb, actorless

  `gtd land` derives who acts from the resolved rest itself — no actor
  argument, no `--if-resting`. Its exit code is the same uniform table every
  command now shares (see docs/cli.md's "Exit codes"): 0 on success — whatever the
  post-land rest turns out to be, `capture`/`message`/`script`/`prompt`/
  `stalled` included — 1 for a refusal, 2 for a usage error (nothing emitted
  either way). Whose turn is next lives entirely in the FOLLOWING
  `gtd next --json`'s own `kind` field, never in `gtd land`'s exit code.
  `gtd step <actor>` is removed outright; `--entry` is only the bare
  `gtd --entry <state>` form.

  @inmem
  Scenario: a capture landing into a prompt state succeeds and lands
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "do it"
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → working"

  @inmem
  Scenario: a clean message rest at the initial state exits 0 (idle) printing nothing to do
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "do it"
      """
    When I run gtd land
    Then the exit code is 0
    And stdout contains "nothing to do at \"idle\""

  @inmem
  Scenario: a landing whose next rest is a message state succeeds
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "do it"
                on:
                  "A DONE.md": waiting
              waiting:
                actor: human
                message: "confirm before continuing"
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "DONE.md" with:
      """
      done
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): working → waiting"

  @inmem
  Scenario: a clean script rest settles at exit 0 and still prints its note
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "* **": checking
              checking:
                actor: check
                script: "true"
                on:
                  "A OUT.txt": idle
      """
    And a commit "gtd(check): checking" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then the exit code is 0
    And stdout contains "nothing to do at \"checking\""

  @inmem
  Scenario: the green --entry fix-precheck probe lands an ordinary commit at exit 0, HEAD never moving backward
    Given a test project
    And the workflow
    And I record the commit count
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    When I run gtd land
    Then the exit code is 0
    And the commit count increased by 2
    And the git log contains "gtd(human): fix-precheck"
    And the git log contains "gtd(check): fix-precheck → idle"

  @inmem
  Scenario: a dirty no-match exits 1 authoring nothing
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "A NOTE.md": working
              working:
                actor: agent
                prompt: "do it"
      """
    And a file "scratch.txt" with:
      """
      an unrelated pending change
      """
    And I record the commit count
    When I run gtd land
    Then the exit code is 1
    And stderr contains "no declared pattern matches"
    And the commit count is unchanged

  @inmem
  Scenario: gtd land human is a usage error — exit 2
    Given a test project
    When I run gtd land with "human"
    Then the exit code is 2
    And stderr contains "too many arguments"

  @inmem
  Scenario: gtd step human prints the REMOVED pointer instead of an unknown-command error — exit 2
    Given a test project
    When I run gtd with args "step human"
    Then the exit code is 2
    And stderr contains "gtd step <actor>"
    And stderr contains "gtd land"
    And stderr contains "gone"

  @inmem
  Scenario: gtd land --sh and --json now exist, carrying script/settled/idle/state/subject/cost/model
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "do it"
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land with "--sh"
    Then the exit code is 0
    And I record stdout as "sh"
    And stdout contains "gtd_state='working'"
    And stdout contains "gtd_subject='gtd(human): idle → working'"
    And stdout does not contain "gtd_settled=true"
    When I run gtd land with "--json"
    Then the exit code is 0
    And stdout contains "\"settled\":false"
    And stdout contains "\"idle\":false"
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"subject\":\"gtd(human): idle → working\""
    And stdout contains "\"cost\":null"
    And stdout contains "\"model\":null"
    When I run gtd land
    Then the exit code is 0
    And the last commit subject is "gtd(human): idle → working"

  @inmem
  Scenario: plain gtd land prints one prose sentence, never the script — --json/--sh alone carry it
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "do it"
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run plain gtd land
    Then the exit code is 0
    And stdout contains "commit everything with this message: gtd(human): idle → working"
    And stdout does not contain "git commit"

  @inmem
  Scenario: gtd land --json reports settled:false, idle:true for the green --entry fix-precheck probe, without landing it
    Given a test project
    And the workflow
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    And I record the commit count
    When I run gtd land with "--json"
    Then the exit code is 0
    And stdout contains "\"settled\":false"
    And stdout contains "\"idle\":true"
    And stdout contains "\"state\":\"idle\""
    And the commit count is unchanged

  @inmem
  Scenario: --sh and --json together on gtd land is still a usage error, exit 2, stdout byte-empty
    Given a test project
    When I run gtd land with "--sh" and "--json"
    Then the exit code is 2
    And stdout is empty
    And stderr contains "mutually exclusive"

  @live
  Scenario: gtd land | bash lands the turn in one pipe
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "do it"
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land piped to bash
    Then the exit code is 0
    And the last commit subject is "gtd(human): idle → working"

