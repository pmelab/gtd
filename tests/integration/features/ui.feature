Feature: gtd ui — the phone/web client's HTTPS listener

  `gtd ui` binds a long-lived HTTPS server exposing the phone/web client for
  THIS worktree — the invoking directory, there is no fleet and no configured
  list of roots to discover one from. It shares the repo-root and at-least-one-commit guard with every other
  state command. Before ever resolving a bind host or a certificate, it reads
  the served worktree's own beat (`gtd next --json`)
  and refuses — exit 2, no port ever bound — unless that beat rests with a
  HUMAN actor carrying a `file`: every other rest has no phone screen to show
  it on, regardless of its reported content kind. Idle is renderable too —
  the phone opens free-form on the idle rest's own `file` (`.gtd/TODO.md`
  below), and the human's write is what eventually moves the
  state, not `gtd ui` itself. Scenarios run the server in-process
  against the in-memory worktree; refusing outside a repository needs a real
  directory, and runs `@live`.

  @inmem
  Scenario: a repository with no commits refuses through the shared repo guard, not gtd ui's own refusal — inverted from when gtd serve skipped this guard entirely
    Given a git repository with no commits
    When I run gtd with args "ui"
    Then it fails
    And stderr contains "gtd: the repository has no commits yet"

  @live
  Scenario: gtd ui outside a git repository refuses through the repo-root guard
    Given a plain directory that is not a git repository
    When I run gtd with args "ui"
    Then it fails
    And stderr contains "not a git repository"

  # ── Refusing to start on a step the UI cannot render (T1) — every case here
  # uses --self-signed --host so ONLY the render gate is under test, never the
  # host/cert resolution the scenarios further down exist to cover. ──────────

  @inmem
  Scenario: gtd ui binds on an idle worktree (the default rest of a fresh project), the phone sketches, hands off, and the sketch stays un-triaged until the next gtd run
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "Sketch the change in .gtd/TODO.md.", file: ".gtd/TODO.md" })
        await agent("planning", "Plan the sketch.")
      }
      """
    And I record the commit count
    When I sketch ".gtd/TODO.md" with the text "a sketch from the phone" then hand off via a spawned gtd ui
    Then gtd ui is still serving after done
    And the file ".gtd/TODO.md" contains "a sketch from the phone"
    And the git status contains ".gtd/TODO.md"
    And the commit count is unchanged

  @inmem
  Scenario: a clean message rest (non-idle), resting with a human but with no steering file, refuses on the actor axis
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("done", { message: "all done" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → done"
    And I run the pin beat
    When I run gtd with args "ui --self-signed --host 100.64.0.1"
    Then it fails
    And the exit code is 2
    And stderr contains "rests with you"

  @inmem
  Scenario: a dirty rest (kind capture), resting with a human but with no steering file, refuses on the steering-file axis — the content kind is never the axis
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("done", { message: "all done" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → done"
    And I run the pin beat
    And a file "scratch.txt" with:
      """
      uncommitted content — dirties the tree, turning the rest into a capture
      """
    When I run gtd with args "ui --self-signed --host 100.64.0.1"
    Then it fails
    And the exit code is 2
    And stderr contains "rests with you"

  @inmem
  Scenario: a script rest, resting with the check actor, refuses on the actor axis
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, run } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await agent("working", "do the work described in NOTE.md")
        await run("checking", "echo hi")
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And I run the pin beat
    And a file "RESULT.md" with:
      """
      done
      """
    When I run gtd land
    Then it succeeds
    When I run gtd with args "ui --self-signed --host 100.64.0.1"
    Then it fails
    And the exit code is 2
    And stderr contains "check"

  @inmem
  Scenario: a stalled rest (a clean-tree agent attempt at a prompt state), resting with the agent actor, refuses on the actor axis
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await agent("working", "do the work described in NOTE.md")
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And I run the pin beat
    And gtd lands "gtd(agent): working"
    When I run gtd with args "ui --self-signed --host 100.64.0.1"
    Then it fails
    And the exit code is 2
    And stderr contains "agent"


  @inmem
  Scenario: a human rest reporting kind message, carrying a file, binds a port and takes a handoff
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("awaiting-review", {
          file: ".gtd/REVIEW.md",
          message: "awaiting your review",
        })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And I run the pin beat
    And a file ".gtd/REVIEW.md" with:
      """
      Paragraph zero here.

      Paragraph two here.
      """
    When I hand off ".gtd/REVIEW.md" with the text "handed back" to a spawned gtd ui
    Then gtd ui is still serving after done
    And the file ".gtd/REVIEW.md" contains "handed back"

  @inmem
  Scenario: a steering file renders as its own structure — headings, a list, and a fenced code block
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("planning", { file: ".gtd/TODO.md", message: "edit the plan" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → planning"
    And I run the pin beat
    And a file ".gtd/TODO.md" with:
      """
      # Plan

      - item one
      - item two

      ```
      echo hi
      ```
      """
    When I read the view of ".gtd/TODO.md" via a spawned gtd ui
    Then the rendered view has a "heading" block at index 0
    And the rendered view has a "list" block at index 1
    And the rendered view has a "code" block at index 2

  # A paragraph write only ever appends, at or past the document's last line.
  # "Paragraph zero here.\n" splits into two lines, so paragraph 1 is the
  # trailing blank row past the last real block.
  @inmem
  Scenario: writing to a steering file via setValue appends the bytes to disk
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("planning", { file: ".gtd/TODO.md", message: "edit the plan" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → planning"
    And I run the pin beat
    And a file ".gtd/TODO.md" with:
      """
      Paragraph zero here.
      """
    When I edit paragraph 1 of ".gtd/TODO.md" with the text "Appended paragraph." via a spawned gtd ui
    Then the file ".gtd/TODO.md" contains "Paragraph zero here."
    And the file ".gtd/TODO.md" contains "Appended paragraph."

  @inmem
  Scenario: picking a single select's option moves the pick on disk and leaves every other byte alone
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("planning", { file: ".gtd/TODO.md", message: "edit the plan" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → planning"
    And I run the pin beat
    And a file ".gtd/TODO.md" with:
      """
      ## 🔘 Pick one

      - [x] APPROVE
      - [ ] REJECT
      """
    When I pick option 2 of widget 1 in ".gtd/TODO.md" via a spawned gtd ui
    Then the file ".gtd/TODO.md" contains "- [ ] APPROVE"
    And the file ".gtd/TODO.md" contains "- [x] REJECT"

  @inmem
  Scenario: writing against a stale token refuses instead of clobbering the file
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("planning", { file: ".gtd/TODO.md", message: "edit the plan" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → planning"
    And I run the pin beat
    And a file ".gtd/TODO.md" with:
      """
      Paragraph zero here.
      """
    When I attempt to edit paragraph 0 of ".gtd/TODO.md" with the text "Clobber attempt." using a stale token via a spawned gtd ui
    Then the write is refused with reason "stale-token"
    And the file ".gtd/TODO.md" contains "Paragraph zero here."
    And the file ".gtd/TODO.md" does not contain "Clobber attempt."

  @inmem
  Scenario: writing against a served path that is a directory refuses instead of truncating it
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("planning", { file: ".gtd/TODO.md", message: "edit the plan" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → planning"
    And I run the pin beat
    And a directory at ".gtd/TODO.md"
    When I attempt to edit paragraph 0 of ".gtd/TODO.md" with the text "Clobber attempt." against an unreadable file via a spawned gtd ui
    Then the write is refused with reason "file-vanished"
    And ".gtd/TODO.md" is still a directory

  @inmem
  Scenario: handing off keeps serving with the edit on disk
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("planning", { file: ".gtd/TODO.md", message: "edit the plan" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → planning"
    And I run the pin beat
    And a file ".gtd/TODO.md" with:
      """
      Paragraph zero here.
      """
    When I hand off ".gtd/TODO.md" with the text "handed back" to a spawned gtd ui
    Then gtd ui is still serving after done
    And the file ".gtd/TODO.md" contains "handed back"

  @inmem
  Scenario: a free-text answer replaces the previous one through a spawned gtd ui
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("awaiting-review", { file: ".gtd/REVIEW.md", message: "awaiting your review" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And I run the pin beat
    And a file ".gtd/REVIEW.md" with:
      """
      ## 🔘 Which storage backend should the new cache layer use?

      - [ ] Redis
      - [x] ✏️ a previous answer
      """
    When I answer option 2 of widget 1 in ".gtd/REVIEW.md" with the text "Go with SQLite on the shared volume instead — it needs no additional infrastructure to operate, unlike every alternative the team considered." via a spawned gtd ui
    Then the file ".gtd/REVIEW.md" contains "- [x] ✏️ Go with SQLite on the shared volume instead"
    And the file ".gtd/REVIEW.md" contains "unlike every alternative the team considered."
    And the file ".gtd/REVIEW.md" does not contain "a previous answer"

  @inmem
  Scenario: a free-text answer from the phone ticks exactly one box of a single select
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("awaiting-review", { file: ".gtd/REVIEW.md", message: "awaiting your review" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And I run the pin beat
    And a file ".gtd/REVIEW.md" with:
      """
      ## 🔘 Token check

      - [ ] fix as suggested
      - [x] won't fix
      - [ ] ✏️
      """
    When I answer option 3 of widget 1 in ".gtd/REVIEW.md" with the text "Only for admin tokens" via a spawned gtd ui
    Then the file ".gtd/REVIEW.md" contains "- [ ] fix as suggested"
    And the file ".gtd/REVIEW.md" contains "- [ ] won't fix"
    And the file ".gtd/REVIEW.md" contains "- [x] ✏️ Only for admin tokens"

  # `resolveBindHost`/`resolveCertPair` themselves (the Tailscale-scan
  # default, --self-signed, ui.cert/ui.key) are pinned deterministically at
  # the unit tier — `src/ui/Server.test.ts`'s own `describe("resolveBindHost"
  # / "resolveCertPair")` blocks, which mock `pickBindHostFromSystem` so the
  # refusal never depends on whatever network interfaces the runner actually
  # has. A `@live` scenario asserting "no Tailscale interface found" can't
  # make that same guarantee — it would depend on the CI/dev machine's real
  # network shape — so that coverage is not duplicated here.

  # Package 02's own printed-URL-carries-the-tailnet-hostname
  # coverage (both the probe-answers and probe-empty paths, `CommandRunner`-
  # doubled) lives at the unit tier instead of here, in
  # `src/ui/Server.test.ts`'s own `describe("runUiCommand")` block: unlike
  # every other assertion in THIS file, it needs `pickBindHostFromSystem` and
  # `CommandRunner` both mockable, which only the in-process unit tier gives —
  # a spawned `@live` subprocess can inject neither, and would additionally
  # depend on the runner's own machine genuinely carrying a Tailscale CGNAT
  # interface to bind at all.

  @inmem
  Scenario: gtd ui --http refuses a non-loopback host
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "Sketch the change in .gtd/TODO.md.", file: ".gtd/TODO.md" })
        await agent("planning", "Plan the sketch.")
      }
      """
    When I run gtd with args "ui --http --host 0.0.0.0"
    Then it fails
    And the exit code is 2
    And stderr contains "loopback"
