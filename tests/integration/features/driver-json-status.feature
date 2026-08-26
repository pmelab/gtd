@inmem
Feature: Driver protocol — gtd next --json content kinds and pattern matches

  Pins the `gtd next --json` contract (`{state, actor, kind, content,
  edges}`, see docs/design/pattern-machine-plan.md §3) for the `script` and
  `prompt` kinds — smoke.feature already pins the `message` kind at `idle` —
  the `edges` list (the resting state's `on` edges as `{pattern, target,
  describe?}`, also what a `message:` template sees as `it.edges`), and gtd's
  pattern-match reporting (plain text and `--json`), which shows which
  declared `on` pattern (if any) each pending change matches. `gtd next
  --json` is now the ONLY structured surface gtd has — `gtd status` is gone,
  and every field it used to carry (state/actor header plus the `--json`
  payload) merged into `gtd next`. Plain `gtd next`'s own output now depends
  on the resolved rest's `kind`: at every kind except `prompt` it prints the
  SAME header block `gtd status` used to print (`State:`/`Awaits:`/etc.),
  then a blank line, then the step content itself; at `kind === "prompt"` it
  drops the header ENTIRELY and is just the bare prompt content, because
  those bytes are the agent's own input — the header fields (`State:`,
  `Label:`, `Model:`, `Memory:`, `File:`, `Mode:`, `Pending:`, `Next:`) are
  observable in plain text ONLY at a non-`prompt` rest; at a `prompt` rest
  they only ever show up in `--json`/`--json=<path>`. `gtd land`'s own
  "settled" signal (a `script` rest's no-op is terminal) is a
  `--json`/`--json=<path>` field (`settled`) — never the exit code, which is
  0 on every successful landing
  regardless — and it also shows in the emitted script's own content (a
  genuine no-op prints "nothing to do" with no `git commit`).

  Scenario: gtd next --json reports kind "script" for a check-actor state
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
                script: "echo hi"
                on:
                  "C": idle
      """
    And a commit "gtd(human): checking" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"checking\""
    And stdout contains "\"actor\":\"check\""
    And stdout contains "\"kind\":\"script\""
    And stdout contains "echo hi"

  Scenario: gtd next --json reports kind "prompt" for an agent-actor state
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
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "\"kind\":\"prompt\""
    And stdout contains "do the work described in NOTE.md"

  Scenario: gtd next --json reports kind "capture" for a message rest with a dirty tree — the human already acted
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
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": idle
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"idle\""
    And stdout contains "\"kind\":\"capture\""

  Scenario: gtd next --json's dispatch block (session/validate) is absent at a script rest, even when a prompt rest nearby would carry it
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
                script: "echo hi"
                on:
                  "C": idle
      """
    And a commit "gtd(human): checking" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"kind\":\"script\""
    And stdout does not contain "\"session\""
    And stdout does not contain "\"validate\""

  Scenario: gtd next --json reports which declared pattern each pending change matches — plain gtd next carries no such report at a prompt rest (header dropped)
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
                message: "go"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "..."
                on:
                  "A DONE.md": done
                  "M .gtd/FEEDBACK.md": fixing
              fixing:
                actor: agent
                prompt: "..."
                on:
                  "* **": working
              done:
                actor: human
                message: "done"
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "DONE.md" with:
      """
      done!
      """
    And a file "scratch.txt" with:
      """
      not matched by any pattern
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Pending:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "\"path\":\"DONE.md\""
    And stdout contains "\"pattern\":\"A DONE.md\""
    And stdout contains "\"path\":\"scratch.txt\""
    And stdout contains "\"pattern\":null"

  Scenario: gtd next --json previews the declared edge that would fire next, action included — plain gtd next never shows it at a prompt rest (header dropped)
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
                message: "go"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "..."
                on:
                  "A DONE.md":
                    to: done
                    action: "Finish up"
              done:
                actor: human
                message: "done"
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "DONE.md" with:
      """
      done!
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Next:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"next\":{\"action\":\"Finish up\",\"pattern\":\"A DONE.md\",\"target\":\"done\"}"

  Scenario: gtd next --json reports no match in "next" when the pending change matches no declared pattern — plain gtd next shows no preview either at a prompt rest
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
                message: "go"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "..."
                on:
                  "A DONE.md": done
              done:
                actor: human
                message: "done"
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "scratch.txt" with:
      """
      not matched by any pattern
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Next:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"next\":null"

  Scenario: gtd next --json carries the owning machine's model hint — plain gtd next never shows it at a prompt rest (header dropped)
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            model: smart
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Model:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"model\":\"smart\""

  Scenario: gtd next --json omits "model" entirely when the owning machine declares none
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
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Model:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout does not contain "\"model\""

  Scenario: gtd next --json/--json=<path> carry the owning machine's system prompt — plain gtd next never shows it
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            system: "You are a careful senior engineer."
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "You are a careful senior engineer."
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"system\":\"You are a careful senior engineer.\""
    When I run gtd next with "--json=system"
    Then it succeeds
    And stdout matches "^You are a careful senior engineer.\n$"

  Scenario: gtd next --json omits "system" entirely, and --json=system prints nothing, when the owning machine declares none
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
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout does not contain "\"system\""
    When I run gtd next with "--json=system"
    Then it succeeds
    And stdout is empty

  Scenario: plain gtd next's prompt output is byte-identical whether or not the machine declares system:
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            system: "You are a careful senior engineer."
            entry: idle
            states:
              idle:
                actor: human
                message: "write NOTE.md to start a process"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next
    Then it succeeds
    And stdout matches "^do the work described in NOTE\.md\n$"

  Scenario: gtd next --json computes a commit-anchored memory key from the resting prompt state's scope — plain gtd next never shows it (header dropped at a prompt rest)
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
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Memory:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout matches "\"memory\":\"root#[0-9a-f]{7}\""

  Scenario: gtd next --json omits "memory" entirely for a non-prompt state — the computed key only ever applies to a prompt turn
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
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": idle
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Memory:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"idle\""
    And stdout does not contain "\"memory\""

  Scenario: gtd next --json carries the state's declared label — plain gtd next never shows it at a prompt rest (header dropped)
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
                label: "Doing the work"
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Label:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"label\":\"Doing the work\""

  Scenario: gtd next --json omits "label" entirely when the state declares none — plain gtd next shows no header either way at a prompt rest
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
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Label:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout does not contain "\"label\""

  Scenario: gtd next --json reports the same pattern matches structurally
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
                message: "go"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "..."
                on:
                  "A DONE.md": done
              done:
                actor: human
                message: "done"
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    And a file "DONE.md" with:
      """
      done!
      """
    And a file "scratch.txt" with:
      """
      not matched by any pattern
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"pattern\":\"A DONE.md\""
    And stdout contains "\"pattern\":null"

  Scenario: gtd next --json carries the state's declared file/mode — plain gtd next shows neither at a prompt rest (header dropped)
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
                file: "PLAN.md"
                mode: qa
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "File:"
    And stdout does not contain "Mode:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"file\":\".gtd/PLAN.md\""
    And stdout contains "\"mode\":\"qa\""

  Scenario: gtd next --json omits "file"/"mode" entirely when the state declares neither — plain gtd next shows no header either way at a prompt rest
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
                prompt: "do the work described in NOTE.md"
                on:
                  "* **": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "File:"
    And stdout does not contain "Mode:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout does not contain "\"file\""
    And stdout does not contain "\"mode\""

  Scenario: the bundled template's idle rest carries the .gtd/TODO.md hint in gtd next --json
    Given a test project
    And the workflow
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"idle\""
    And stdout contains "\"file\":\".gtd/TODO.md\""

  Scenario: a human gate's message renders its `on` edge descriptions as a route list, and gtd next --json carries the same edges
    Given a test project
    And a gtd config file at ".gtdrc" with:
      """
      workflow:
        entry:
          default: root
        machines:
          root:
            entry: gate
            states:
              gate:
                actor: human
                message: |
                  Decide what to do next.

                  What each change does next (then run `gtd land`):
                  <% it.edges.forEach(function (e) { if (e.describe) { %>
                  <%~ "- " + e.describe + "\n" %>
                  <% } }) %>
                on:
                  "C":
                    to: accept
                    describe: "Change nothing to accept the current state and proceed."
                  "* **":
                    to: revise
                    describe: "Change any source file to leave feedback and start another round."
              accept:
                actor: human
                message: "accept"
              revise:
                actor: agent
                prompt: "revise"
                on:
                  "* **": gate
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "What each change does next (then run `gtd land`):"
    And stdout contains "- Change nothing to accept the current state and proceed."
    And stdout contains "- Change any source file to leave feedback and start another round."
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"pattern\":\"C\""
    And stdout contains "\"target\":\"accept\""
    And stdout contains "\"describe\":\"Change nothing to accept the current state and proceed.\""
    And stdout contains "\"target\":\"revise\""

  Scenario: a string-form `on` edge emits an edge with no describe, and gtd next --json omits "edges" for a commit-only-target state with none
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
                message: "go"
                on:
                  "* **": working
              working:
                actor: agent
                prompt: "..."
                on:
                  "* **": idle
      """
    And a commit "gtd(human): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"edges\":[{\"pattern\":\"* **\",\"target\":\"idle\"}]"
    And stdout does not contain "\"describe\""

  Scenario: gtd next --json reports the per-worktree loop log path by default (gtd#169)
    Given a test project
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"log\":\".git/gtd-loop.log\""

  Scenario: gtd next --json reports GTD_LOOP_LOG verbatim when set (gtd#169)
    Given a test project
    And an environment variable "GTD_LOOP_LOG" set to "/tmp/run.log"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"log\":\"/tmp/run.log\""

  Scenario: gtd land settles at a script rest that matched nothing — a print-only script, no git commit
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
                script: "echo hi"
                on:
                  "A OUT.txt": idle
      """
    And a commit "gtd(check): checking" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it settles
    And stdout contains "nothing to do"
    And stdout does not contain "git commit"

  Scenario: gtd land is not settled at a prompt rest that matched nothing — that's an attempt, not a terminal state
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
                prompt: "do the work described in NOTE.md"
                on:
                  "A DONE.md": idle
      """
    And a commit "gtd(agent): working" that adds "NOTE.md" with:
      """
      a note
      """
    When I run gtd land with "--json"
    Then it succeeds
    And stdout contains "\"settled\":false"

  Scenario: gtd land lands an ordinary commit for a green re-entry into the initial state — HEAD never moves backward
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
                script: "echo hi"
                on:
                  "C": idle
      """
    And I record the commit count
    And an empty commit "gtd(check): checking"
    When I run gtd land
    Then it succeeds
    And the commit count increased by 2
    And the last commit subject is "gtd(check): checking → idle"
