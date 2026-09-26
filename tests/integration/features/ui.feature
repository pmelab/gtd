Feature: gtd ui — the phone/web client's HTTPS listener

  `gtd ui` binds a long-lived HTTPS server exposing the phone/web client for
  THIS worktree — the invoking directory, there is no fleet and no configured
  list of roots to discover one from. It shares the repo-root and at-least-one-commit guard with every other
  state command. Before ever resolving a bind host or a certificate, it reads
  the served worktree's own beat (a real `gtd next --json` subprocess spawn)
  and refuses — exit 2, no port ever bound — unless that beat rests with a
  HUMAN actor carrying a `file`: every other rest has no phone screen to show
  it on, regardless of its reported content kind. Idle is renderable too —
  the phone opens free-form on the idle rest's own `file` (`.gtd/TODO.md` in
  the bundled workflow), and the human's write is what eventually moves the
  state, not `gtd ui` itself. `mode` is NOT part of that axis — an absent or
  unregistered mode renders free-form. That beat read needs a REAL
  worktree underneath it, so every scenario below that gets past it (or
  specifically proves a NON-renderable rest) is `@live`; only the two fast,
  purely config/guard-level refusals stay `@inmem`.

  @inmem
  Scenario: a repository with no commits refuses through the shared repo guard, not gtd ui's own refusal — inverted from when gtd serve skipped this guard entirely
    Given a git repository with no commits
    When I run gtd with args "ui"
    Then it fails
    And stderr contains "gtd requires a repository with at least one commit"

  @live
  Scenario: gtd ui outside a git repository refuses through the repo-root guard
    Given a plain directory that is not a git repository
    When I run gtd with args "ui"
    Then it fails
    And stderr contains "not a git repository"

  # ── Refusing to start on a step the UI cannot render (T1) — every case here
  # uses --self-signed --host so ONLY the render gate is under test, never the
  # host/cert resolution the scenarios further down exist to cover. ──────────

  @live
  Scenario: gtd ui binds on an idle worktree (the default rest of a fresh project), the phone sketches, hands off, and the sketch stays un-triaged until the next gtd run
    Given a test project
    And I record the commit count
    When I sketch ".gtd/TODO.md" with the text "a sketch from the phone" then hand off via a spawned gtd ui
    Then the reported exit status is 0
    And the file ".gtd/TODO.md" contains "a sketch from the phone"
    And the git status contains ".gtd/TODO.md"
    And the commit count is unchanged

  @live
  Scenario: a clean message rest (non-idle), resting with a human but with no steering file, refuses on the actor axis
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start" })
          await human("done", { message: "all done" })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → done"
    When I run gtd with args "ui --self-signed --host 100.64.0.1"
    Then it fails
    And the exit code is 2
    And stderr contains "rests with you"

  @live
  Scenario: a dirty rest (kind capture), resting with a human but with no steering file, refuses on the steering-file axis — the content kind is never the axis
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start" })
          await human("done", { message: "all done" })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → done"
    And a file "scratch.txt" with:
      """
      uncommitted content — dirties the tree, turning the rest into a capture
      """
    When I run gtd with args "ui --self-signed --host 100.64.0.1"
    Then it fails
    And the exit code is 2
    And stderr contains "rests with you"

  @live
  Scenario: a script rest, resting with the check actor, refuses on the actor axis
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, run, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start" })
          await agent("working", "do the work described in NOTE.md")
          await run("checking", "echo hi")
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
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

  @live
  Scenario: a stalled rest (a clean-tree agent attempt at a prompt state), resting with the agent actor, refuses on the actor axis
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start" })
          await agent("working", "do the work described in NOTE.md")
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And gtd lands "gtd(agent): working"
    When I run gtd with args "ui --self-signed --host 100.64.0.1"
    Then it fails
    And the exit code is 2
    And stderr contains "agent"


  @live
  Scenario: a prompt rest resting with a human, whose mode resolves to no registered steering format, binds a port instead of refusing
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start" })
          await human("working", {
            file: ".gtd/PLAN.md",
            mode: "custom-mode",
            message: "answer the plan",
          })
        },
      })
      """
    And a gtd config file at ".gtdrc" with:
      """
      modes:
        custom-mode:
          validate: "true"
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → working"
    And a file ".gtd/PLAN.md" with:
      """
      Paragraph zero here.
      """
    When I hand off ".gtd/PLAN.md" in mode "custom-mode" with the text "handed back" to a spawned gtd ui
    Then the reported exit status is 0
    And the file ".gtd/PLAN.md" contains "handed back"

  # ── The positive scenario that fails today (T7): a human rest carrying a
  # `file` and a registered `mode`, reporting kind `message` (not `prompt`) —
  # the exact shape of `build.review.await-review` — binds a port and exits
  # 0. The pre-existing render gate (kind === "prompt") refuses this with
  # exit 2; only the actor-based gate this package installs admits it.
  # Proven via the same real spawn-and-handoff round trip
  # `ui-lifecycle.feature` already uses (`world.ts#spawnGtdUiAndHandOff`) —
  # bind, then a real HTTPS tRPC `done` call, then the process exits 0 on
  # its own. ─────────────────────────────────────────────────────────────

  @live
  Scenario: a human rest reporting kind message, carrying a file and a registered mode, binds a port and exits 0
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start" })
          await human("awaiting-review", {
            file: ".gtd/REVIEW.md",
            mode: "qa",
            message: "awaiting your review",
          })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And a file ".gtd/REVIEW.md" with:
      """
      Paragraph zero here.

      Paragraph two here.
      """
    When I hand off ".gtd/REVIEW.md" in mode "qa" with the text "handed back" to a spawned gtd ui
    Then the reported exit status is 0
    And the file ".gtd/REVIEW.md" contains "handed back"

  # ── Package 01 Task 10 — a genuinely mode-less rest (no `mode:` key at all
  # on the state, distinct from the unregistered-`custom-mode` scenario
  # above): renders its own structure, accepts a block edit, refuses a stale
  # write, hands off, and formats on write — the free-form screen's own
  # end-to-end acceptance. Every scenario below shares the same workflow
  # shape: `idle` (write NOTE.md to start) → `planning`, a human rest
  # carrying `file: ".gtd/TODO.md"` and no `mode` at all. ─────────────────────

  @live
  Scenario: a mode-less steering file renders as its own structure — headings, a list, and a fenced code block
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start" })
          await human("planning", { file: ".gtd/TODO.md", message: "edit the plan" })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → planning"
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

  # Package 02 (improve-free-form-ui) dropped free-form's per-block
  # replace/delete: `freeform.ts#freeFormApply` now only ever appends, at or
  # past the document's own last line — an anchor matching a real block's
  # own start line (paragraph 0 below) now refuses `anchor-not-found`
  # instead. "Paragraph zero here.\n" splits into two lines
  # (`["Paragraph zero here.", ""]`), so paragraph 1 is that trailing blank
  # row past the last real block — the append target this scenario now
  # exercises.
  @live
  Scenario: writing to a mode-less steering file via setValue appends the bytes to disk
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start" })
          await human("planning", { file: ".gtd/TODO.md", message: "edit the plan" })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → planning"
    And a file ".gtd/TODO.md" with:
      """
      Paragraph zero here.
      """
    When I edit paragraph 1 of ".gtd/TODO.md" with the text "Appended paragraph." via a spawned gtd ui
    Then the file ".gtd/TODO.md" contains "Paragraph zero here."
    And the file ".gtd/TODO.md" contains "Appended paragraph."

  @live
  Scenario: writing against a stale token refuses instead of clobbering the file
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start" })
          await human("planning", { file: ".gtd/TODO.md", message: "edit the plan" })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → planning"
    And a file ".gtd/TODO.md" with:
      """
      Paragraph zero here.
      """
    When I attempt to edit paragraph 0 of ".gtd/TODO.md" with the text "Clobber attempt." using a stale token via a spawned gtd ui
    Then the write is refused with reason "stale-token"
    And the file ".gtd/TODO.md" contains "Paragraph zero here."
    And the file ".gtd/TODO.md" does not contain "Clobber attempt."

  @live
  Scenario: writing against a served path that is a directory refuses instead of truncating it
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start" })
          await human("planning", { file: ".gtd/TODO.md", message: "edit the plan" })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → planning"
    And a directory at ".gtd/TODO.md"
    When I attempt to edit paragraph 0 of ".gtd/TODO.md" with the text "Clobber attempt." against an unreadable file via a spawned gtd ui
    Then the write is refused with reason "file-vanished"
    And ".gtd/TODO.md" is still a directory

  @live
  Scenario: handing off a genuinely mode-less rest (no mode key at all) exits 0 with the edit on disk
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start" })
          await human("planning", { file: ".gtd/TODO.md", message: "edit the plan" })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → planning"
    And a file ".gtd/TODO.md" with:
      """
      Paragraph zero here.
      """
    When I hand off ".gtd/TODO.md" with the text "handed back" to a spawned gtd ui
    Then the reported exit status is 0
    And the file ".gtd/TODO.md" contains "handed back"

  @live
  Scenario: ui.format rewrites a mode-less write, and a second write against the returned hash still succeeds
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start" })
          await human("planning", { file: ".gtd/TODO.md", message: "edit the plan" })
        },
      })
      """
    And a gtd config file at ".gtdrc" with:
      """
      ui:
        format: 'printf "FORMATTED\n" >> <%= it.file %>'
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → planning"
    And a file ".gtd/TODO.md" with:
      """
      Paragraph zero here.
      """
    # `freeFormApply` now only ever appends (package 02, improve-free-form-ui)
    # — line 9999 is always past the document's own last line, both before
    # and after `ui.format` grows the file, so both writes below land as
    # appends rather than needing to track the file's real length.
    When I write "First edit." then "Second edit." to paragraph 9999 of ".gtd/TODO.md" via a spawned gtd ui, reusing the first write's returned hash
    Then the file ".gtd/TODO.md" contains "FORMATTED"
    And the file ".gtd/TODO.md" contains "Second edit."
    And the second write succeeded

  # ── Package 06's Task 4: a design document's free-text answer, typed long
  # enough to wrap past 80 columns, must survive a real save through a
  # spawned `gtd ui` byte-for-byte — replacing a PREVIOUS wrapped answer's own
  # continuation lines whole, never leaving a stale tail welded onto the new
  # text (`qa.ts#optionTextSpan`'s whole-paragraph span, package 06 Task 1).
  # ──────────────────────────────────────────────────────────────────────

  @live
  Scenario: a free-text answer typed long enough to wrap saves byte-for-byte through a spawned gtd ui, with no tail of the previous wrapped answer left behind
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human, workflow } from "@pmelab/gtd/flows"

      export default workflow({
        default: async () => {
          await human("idle", { message: "write NOTE.md to start" })
          await human("awaiting-review", {
            file: ".gtd/REVIEW.md",
            mode: "qa",
            message: "awaiting your review",
          })
        },
      })
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And a file ".gtd/REVIEW.md" with:
      """
      ## Open Questions

      ### Which storage backend should the new cache layer use?

      - [ ] Redis
      - [x] a previous long answer that already wraps across two whole
            continuation lines from an earlier save
      """
    When I answer option 1 of question 0 in ".gtd/REVIEW.md" mode "qa" with the text "Go with SQLite on the shared volume instead — it needs no additional infrastructure to operate, unlike every alternative the team considered." via a spawned gtd ui
    Then the file ".gtd/REVIEW.md" contains "Go with SQLite on the shared volume instead"
    And the file ".gtd/REVIEW.md" contains "unlike every alternative the team considered."
    And the file ".gtd/REVIEW.md" does not contain "a previous long answer"
    And the file ".gtd/REVIEW.md" does not contain "continuation lines from an earlier save"

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
