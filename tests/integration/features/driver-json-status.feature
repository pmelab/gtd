@inmem
Feature: Driver protocol — gtd next --json content kinds, edges and pending changes

  Pins the `gtd next --json` contract for the `script`, `prompt` and
  `capture` kinds — smoke.feature already pins the `message` kind at `idle`.
  `edges` lists the resting step's out-edges in the workflow's step graph as
  `{pattern, target}`, where `pattern` is the flow condition that leads
  there (empty for an unconditional edge); `next` previews the step the
  pending change would land the process at, or `null` when the flow would
  refuse it; `changes` lists every pending change's status and path. `gtd
  next --json` is the ONLY structured surface gtd has. Plain `gtd next`'s
  own output depends on the resolved rest's `kind`: at every kind except
  `prompt` it prints a header block (`State:`/`Awaits:`/etc.), then a blank
  line, then the step content itself; at `kind === "prompt"` it drops the
  header ENTIRELY and is just the bare prompt content, because those bytes
  are the agent's own input — the header fields (`State:`, `Label:`,
  `Model:`, `Memory:`, `File:`, `Mode:`, `Pending:`, `Next:`) are observable
  in plain text ONLY at a non-`prompt` rest; at a `prompt` rest they only
  ever show up in `--json`/`--json=<path>`. `gtd land`'s own "settled" signal
  (a `script` rest's no-op is terminal) is a `--json`/`--json=<path>` field
  (`settled`) — never the exit code, which is 0 on every successful landing
  regardless — and it also shows in the emitted script's own content (a
  genuine no-op prints "nothing to do" with no `git commit`).

  Scenario: gtd next --json reports kind "script" for a check-actor state
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, run, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await run("checking", "echo hi")
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → checking"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"checking\""
    And stdout contains "\"actor\":\"check\""
    And stdout contains "\"kind\":\"script\""
    And stdout contains "echo hi"

  Scenario: gtd next --json reports kind "prompt" for an agent-actor state
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await agent("working", "do the work described in NOTE.md")
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"actor\":\"agent\""
    And stdout contains "\"kind\":\"prompt\""
    And stdout contains "do the work described in NOTE.md"

  Scenario: gtd next --json reports kind "capture" for a message rest with a dirty tree — the human already acted
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await agent("working", "do the work described in NOTE.md")
        },
      })
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
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, run, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await run("checking", "echo hi")
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → checking"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"kind\":\"script\""
    And stdout does not contain "\"session\""
    And stdout does not contain "\"validate\""

  Scenario: gtd next --json lists each pending change with its status, matched against no pattern — plain gtd next carries no such report at a prompt rest (header dropped)
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, agent, human, modified, refuse, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "go" })
          for (;;) {
            await agent("working", "...")
            if (added("DONE.md").length > 0) break
            if (modified(".gtd/FEEDBACK.md").length === 0) refuse("working must add DONE.md or edit .gtd/FEEDBACK.md")
            await agent("fixing", "...")
          }
          await human("done", { message: "done" })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
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
    And stdout contains "{\"status\":\"A\",\"path\":\"DONE.md\",\"pattern\":null}"
    And stdout contains "\"path\":\"scratch.txt\""
    And stdout contains "\"pattern\":null"

  Scenario: gtd next --json previews the step the pending change would land at — plain gtd next never shows it at a prompt rest (header dropped)
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, agent, human, refuse, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "go" })
          await agent("working", "...")
          if (added("DONE.md").length === 0) refuse("working must add DONE.md")
          await human("done", { message: "done" })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And a file "DONE.md" with:
      """
      done!
      """
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Next:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout matches "\"next\":[{][^}]*\"target\":\"done\"[}]"

  Scenario: gtd next --json reports no match in "next" when the flow would refuse the pending change — plain gtd next shows no preview either at a prompt rest
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, agent, human, refuse, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "go" })
          await agent("working", "...")
          if (added("DONE.md").length === 0) refuse("working must add DONE.md")
          await human("done", { message: "done" })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
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

  Scenario: gtd next --json carries the enclosing persona's model hint — plain gtd next never shows it at a prompt rest (header dropped)
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, persona, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await persona({ model: "smart" }, () => agent("working", "do the work described in NOTE.md"))
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Model:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"model\":\"smart\""

  Scenario: gtd next --json omits "model" entirely when no persona declares one
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await agent("working", "do the work described in NOTE.md")
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Model:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout does not contain "\"model\""

  Scenario: gtd next --json/--json=<path> carry the enclosing persona's system prompt — plain gtd next never shows it
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, persona, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await persona({ system: "You are a careful senior engineer." }, () =>
            agent("working", "do the work described in NOTE.md"),
          )
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
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

  Scenario: gtd next --json omits "system" entirely, and --json=system prints nothing, when no persona declares one
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await agent("working", "do the work described in NOTE.md")
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout does not contain "\"system\""
    When I run gtd next with "--json=system"
    Then it succeeds
    And stdout is empty

  Scenario: plain gtd next's prompt output is byte-identical whether or not a persona declares a system prompt
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, persona, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await persona({ system: "You are a careful senior engineer." }, () =>
            agent("working", "do the work described in NOTE.md"),
          )
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next
    Then it succeeds
    And stdout matches "^do the work described in NOTE\.md\n$"

  Scenario: gtd next --json computes a commit-anchored memory key from the resting prompt step's scope — plain gtd next never shows it (header dropped at a prompt rest)
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await agent("working", "do the work described in NOTE.md")
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Memory:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout matches "\"memory\":\"root#[0-9a-f]{7}\""

  Scenario: gtd next --json omits "memory" entirely for a non-prompt state — the computed key only ever applies to a prompt turn
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await agent("working", "do the work described in NOTE.md")
        },
      })
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
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await agent("working", "do the work described in NOTE.md", { label: "Doing the work" })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Label:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout contains "\"label\":\"Doing the work\""

  Scenario: gtd next --json omits "label" entirely when the state declares none — plain gtd next shows no header either way at a prompt rest
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await agent("working", "do the work described in NOTE.md")
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next
    Then it succeeds
    And stdout does not contain "Label:"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"working\""
    And stdout does not contain "\"label\""

  Scenario: gtd next --json reports every pending change structurally
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, agent, human, refuse, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "go" })
          await agent("working", "...")
          if (added("DONE.md").length === 0) refuse("working must add DONE.md")
          await human("done", { message: "done" })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
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
    And stdout contains "{\"status\":\"A\",\"path\":\"DONE.md\",\"pattern\":null}"
    And stdout contains "\"pattern\":null"

  Scenario: gtd next --json carries the state's declared file/mode — plain gtd next shows neither at a prompt rest (header dropped)
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await agent("working", "do the work described in NOTE.md", { file: ".gtd/PLAN.md", mode: "qa" })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
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
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await agent("working", "do the work described in NOTE.md")
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
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

  Scenario: a human gate's message lists its routes, and gtd next --json carries the gate's out-edges labelled by their conditions
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changed, human, workflow } from "@pmelab/gtd/flows"

      const routes = `Decide what to do next.

      What each change does next (then run \`gtd land\`):
      - Change nothing to accept the current state and proceed.
      - Change any source file to leave feedback and start another round.
      `

      export default workflow({
        default: async () => {
          for (;;) {
            await human("gate", { message: routes, acceptClean: true })
            if (changed().length === 0) break
            await agent("revise", "revise")
          }
          await human("accept", { message: "accept" })
        },
      })
      """
    When I run gtd next
    Then it succeeds
    And stdout contains "What each change does next (then run `gtd land`):"
    And stdout contains "- Change nothing to accept the current state and proceed."
    And stdout contains "- Change any source file to leave feedback and start another round."
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "{\"pattern\":\"changed().length === 0\",\"target\":\"accept\"}"
    And stdout contains "\"target\":\"accept\""
    And stdout does not contain "\"describe\""
    And stdout contains "\"target\":\"revise\""

  Scenario: an unconditional out-edge carries an empty pattern and no describe
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "go" })
          await agent("working", "...")
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"edges\":[{\"pattern\":\"\",\"target\":\"idle\"}]"
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
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, human, run, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          do {
            await run("checking", "echo hi")
          } while (added("OUT.txt").length === 0)
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → checking"
    When I run gtd land
    Then it settles
    And stdout contains "nothing to do"
    And stdout does not contain "git commit"

  Scenario: gtd land is not settled at a prompt rest that matched nothing — that's an attempt, not a terminal state
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { added, agent, human, refuse, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await agent("working", "do the work described in NOTE.md")
          if (added("DONE.md").length === 0) refuse("working must add DONE.md")
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    When I run gtd land with "--json"
    Then it succeeds
    And stdout contains "\"settled\":false"

  Scenario: gtd land lands an ordinary commit for a green re-entry into the initial state — HEAD never moves backward
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, run, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start a process" })
          await run("checking", "echo hi")
        },
      })
      """
    And I record the commit count
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → checking"
    When I run gtd land
    Then it succeeds
    And the commit count increased by 2
    And the last commit subject is "gtd(check): checking → idle"
