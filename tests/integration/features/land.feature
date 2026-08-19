Feature: gtd land — the one landing verb, actorless — the exit-code contract

  `gtd land` derives who acts from the resolved rest itself — no actor
  argument, no `--if-resting`. This pins the OWNER exit-code contract a driver
  relies on (see README's "Exit codes"): 10 when the post-land rest needs an
  agent turn (`script`/`prompt`), 20 when it needs a human turn
  (`capture`/`message`/`stalled`), 0 when nothing is owed — a benign no-op at
  a clean `script` rest, or a squash/collapse back to the workflow's initial
  state — 1 for a refusal, 2 for a usage error (nothing emitted either way).
  `gtd step <actor>` is removed outright; `--entry` is only the bare
  `gtd --entry <state>` form.

  @inmem
  Scenario: a capture landing into a prompt state exits 10 and lands
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
    Then it awaits the agent
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
  Scenario: a landing whose next rest is a message state exits 20
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
    Then it awaits the human
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
  Scenario: the green --entry fix-precheck collapse (a squash) settles at exit 0 with the commit count unchanged
    Given a test project
    And the workflow
    And I record the commit count
    When I run gtd with args "--entry fix-precheck"
    Then it succeeds
    When I run gtd land
    Then the exit code is 0
    And the commit count is unchanged
    And the git log does not contain "gtd("

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
  Scenario: --json is a usage error on gtd land — status is the only structured surface now
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
    When I run gtd land with "--json"
    Then the exit code is 2
    And stdout is empty
    And stderr contains "only valid for `gtd status`"

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
    Then the exit code is 10
    And the last commit subject is "gtd(human): idle → working"

  @live
  Scenario: a land whose optional tail (the review-window open) fails still lands the required half — the failure is swallowed, only warned about
    # `combinedScript` wraps `optional` in a subshell whose non-zero exit is
    # discarded (`( … ) || printf … >&2`) — this forces exactly that failure
    # for real, by blocking the review-window open script's own
    # `git update-ref refs/worktree/gtd/review-head HEAD` with a non-empty
    # directory sitting at that exact ref path, so git can't write the ref
    # file there. This targets the SECOND of the open script's four
    # `&&`-joined git writes, so the first (`review-base`) still lands but the
    # rest of that chain (including the HEAD rewind to the review base) never
    # runs — none of which touches anything `required` needs.
    Given a test project
    And the workflow
    And a commit "gtd(agent): building" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And an empty commit "gtd(check): build.review.reviewing"
    And a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc
      - [ ] ./src/calc.ts#1
      new add function
      """
    And a file ".git/refs/worktree/gtd/review-head/blocker" with:
      """
      x
      """
    And I record the commit count
    When I run gtd land
    Then it succeeds
    And the commit count increased by 1
    And the emitted script printed "gtd: presentation-only follow-up failed — continuing"
    And the git ref "refs/worktree/gtd/review-base" exists
    And the git ref "refs/worktree/gtd/review-head" does not exist
