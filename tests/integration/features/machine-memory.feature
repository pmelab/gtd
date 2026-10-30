@inmem
Feature: Machine-scoped memory — a computed <scope>#<hash> key, not an authored label

  A `prompt`-content step's memory key is COMPUTED, never authored per step:
  the scope is the step name's `scope()` prefix (`""` for the root, `"build"`,
  `"build.health"`, ...), and the key is `<scope>#<hash7>` — the first 7 hex
  characters of the commit the CURRENT unbroken run into that scope started
  FROM. Entering a DESCENDANT scope (a true dotted-prefix match) doesn't break
  the ancestor's run; entering a sibling or unrelated scope does. These
  scenarios pin that end to end, via `gtd next --json`'s `.memory` field.

  Scenario: memory is retained across a scope's own laps — design.triage resumes across a design.gate.answer turn in between
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, changes, human, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await scope("design", async () => {
          for (;;) {
            await agent("triage", "plan", { file: ".gtd/REQUIREMENTS.md" })
            await scope("gate", () =>
              human("answer", { file: ".gtd/REQUIREMENTS.md", message: "answer", acceptClean: true }),
            )
            if (changes().length === 0) return
          }
        })
        await agent("build", "build it")
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(human): idle → design.triage"
    And I run the pin beat
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.triage\""
    And I record the json field "memory" as "first lap"

    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing. Which storage backend?
      """
    And gtd lands "gtd(agent): design.triage → design.gate.answer"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.gate.answer\""
    And stdout does not contain "\"memory\""

    Given ".gtd/REQUIREMENTS.md" is modified to:
      """
      Build a thing. Which storage backend? SQLite.
      """
    And gtd lands "gtd(human): design.gate.answer → design.triage"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"design.triage\""
    And the json field "memory" matches the one recorded as "first lap"

  Scenario: a still-red check loops build.fix back into itself without leaving "build", resuming its session
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, check, human, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await scope("build", async () => {
          let reds = 0
          for (;;) {
            await agent("fix", "fix it")
            const green = await scope("health", async () => {
              if (await check("check", "npm test", ".gtd/FEEDBACK.md")) return true
              if (++reds < 2) return false
              reds = 0
              await agent("describe", "describe the failure", { file: ".gtd/ESCALATION.md" })
              await human("stop", { message: "read .gtd/ESCALATION.md", acceptClean: true })
              return false
            })
            if (green) return
          }
        })
        await agent("done", "finish")
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(human): idle → build.fix"
    And I run the pin beat
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And I record the json field "memory" as "first fix attempt"

    Given a file "src/widget.ts" with:
      """
      export const widget = () => undefined
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.health.check\""
    And stdout does not contain "\"memory\""

    Given a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): build.health.check → build.fix"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And the json field "memory" matches the one recorded as "first fix attempt"

  Scenario: memory is retained across an excursion into a child scope's own describe/stop — build.fix resumes across the whole detour
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, check, human, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await scope("build", async () => {
          let reds = 0
          for (;;) {
            await agent("fix", "fix it")
            const green = await scope("health", async () => {
              if (await check("check", "npm test", ".gtd/FEEDBACK.md")) return true
              if (++reds < 2) return false
              reds = 0
              await agent("describe", "describe the failure", { file: ".gtd/ESCALATION.md" })
              await human("stop", { message: "read .gtd/ESCALATION.md", acceptClean: true })
              return false
            })
            if (green) return
          }
        })
        await agent("done", "finish")
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(human): idle → build.fix"
    And I run the pin beat
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And I record the json field "memory" as "first fix attempt"

    Given a file "src/widget.ts" with:
      """
      export const widget = () => undefined
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.health.check\""
    And stdout does not contain "\"memory\""

    Given a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): build.health.check → build.fix"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And the json field "memory" matches the one recorded as "first fix attempt"

    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/widget.ts" with:
      """
      export const widget = () => null
      """
    And gtd lands "gtd(agent): build.fix → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed again: widget() still returns undefined
      """
    And gtd lands "gtd(check): build.health.check → build.health.describe"
    # build.health.describe is its own memory key, scoped to build.health,
    # distinct from build.fix's own "build"-scoped key recorded above.
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.health.describe\""
    And the json field "memory" differs from the one recorded as "first fix attempt"
    And I record the json field "memory" as "the escalation turn"

    Given a file ".gtd/ESCALATION.md" with:
      """
      what's failing, and a suggested approach
      """
    And gtd lands "gtd(agent): build.health.describe → build.health.stop"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.health.stop\""
    And stdout does not contain "\"memory\""

    Given gtd lands "gtd(human): build.health.stop → build.fix"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.fix\""
    And the json field "memory" matches the one recorded as "first fix attempt"
    And the json field "memory" differs from the one recorded as "the escalation turn"

  Scenario: a nested child scope never reuses its caller's session — implement.fix.suite.fixing gets its own, not implement.building's
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await scope("implement", async () => {
          await agent("building", "build it")
          await scope("fix", () => scope("suite", () => agent("fixing", "fix it")))
        })
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(human): idle → implement.building"
    And I run the pin beat
    When I run gtd next with "--json"
    Then it succeeds
    And I record the json field "memory" as "the builder's turn"

    Given a file "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    And gtd lands "gtd(agent): implement.building → implement.fix.suite.fixing"
    When I run gtd next with "--json"
    Then it succeeds
    And the json field "memory" differs from the one recorded as "the builder's turn"
    And stdout matches "\"memory\":\"implement\.fix\.suite#[0-9a-f]{7}\""

  Scenario: two instances of one scope-shaped helper never share a session, even with byte-identical check output
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, check, human, scope } from "@pmelab/gtd/flows"

      const healthy = () =>
        scope("health", async () => {
          while (!(await check("check", "npm test", ".gtd/FEEDBACK.md")))
            await agent("fixing", "fix it")
        })

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await scope("build", async () => {
          await agent("work", "build it")
          await healthy()
        })
        await scope("implement", async () => {
          await agent("work", "build it")
          await healthy()
        })
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(human): idle → build.work"
    And I run the pin beat
    And a file "src/widget.ts" with:
      """
      export const widget = () => undefined
      """
    And gtd lands "gtd(agent): build.work → build.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): build.health.check → build.health.fixing"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout matches "\"memory\":\"build\.health#[0-9a-f]{7}\""
    And I record the json field "memory" as "build's health fix"

    Given the file ".gtd/FEEDBACK.md" is deleted
    And a file "src/widget.ts" with:
      """
      export const widget = () => 1
      """
    And gtd lands "gtd(agent): build.health.fixing → build.health.check"
    And gtd lands "gtd(check): build.health.check → implement.work"
    And a file "src/widget.ts" with:
      """
      // The widget.
      export const widget = () => undefined
      """
    And gtd lands "gtd(agent): implement.work → implement.health.check"
    And a file ".gtd/FEEDBACK.md" with:
      """
      test failed: widget() returns undefined
      """
    And gtd lands "gtd(check): implement.health.check → implement.health.fixing"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout matches "\"memory\":\"implement\.health#[0-9a-f]{7}\""
    And the json field "memory" differs from the one recorded as "build's health fix"

  Scenario: a loop-back through sibling scopes breaks every run it leaves — round 2's builder and collecting turns get fresh sessions
    # Getting back to build after a round passes out through design, which is
    # no descendant of build or build.review — so each round starts both
    # conversations fresh.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        for (let round = 1; round <= 2; round++) {
          await scope("design", () => agent("triage", "plan"))
          await scope("build", async () => {
            await agent("work", "build it")
            await scope("review", async () => {
              await human("await-review", { message: "review it" })
              await agent("collecting", "collect the feedback")
            })
          })
        }
        await human("done", { message: "done" })
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(human): idle → design.triage"
    And I run the pin beat
    And a file "PLAN.md" with:
      """
      round 1
      """
    And gtd lands "gtd(agent): design.triage → build.work"
    When I run gtd next with "--json"
    Then it succeeds
    And I record the json field "memory" as "round 1's builder"
    Given a file "src/widget.ts" with:
      """
      export const widget = () => 1
      """
    And gtd lands "gtd(agent): build.work → build.review.await-review"
    And a file "src/greet.ts" with:
      """
      export const greet = "hello"
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.collecting"
    When I run gtd next with "--json"
    Then it succeeds
    And I record the json field "memory" as "round 1's collecting turn"
    Given a file "PLAN.md" with:
      """
      round 2: add a doc comment
      """
    And gtd lands "gtd(agent): build.review.collecting → design.triage"
    And a file "PLAN.md" with:
      """
      round 2: add a doc comment above the widget export
      """
    And gtd lands "gtd(agent): design.triage → build.work"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.work\""
    And the json field "memory" differs from the one recorded as "round 1's builder"
    Given a file "src/widget.ts" with:
      """
      // The widget.
      export const widget = () => 1
      """
    And gtd lands "gtd(agent): build.work → build.review.await-review"
    And a file "src/greet.ts" with:
      """
      export const greet = "hi"
      """
    And gtd lands "gtd(human): build.review.await-review → build.review.collecting"
    When I run gtd next with "--json"
    Then it succeeds
    And stdout contains "\"state\":\"build.review.collecting\""
    And the json field "memory" differs from the one recorded as "round 1's collecting turn"

  Scenario: sibling scopes are separate conversations — design, seam, implement and the review after them each start fresh
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human, scope } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await scope("design", () => agent("triage", "plan"))
        await scope("seam", () => agent("naive", "try it"))
        await scope("implement", () => agent("building", "build it"))
        await scope("build", () =>
          scope("quality", () => scope("correctness", () => agent("reviewing", "review it"))),
        )
      }
      """
    And a file "NOTE.md" with:
      """
      a sketch
      """
    And gtd lands "gtd(human): idle → design.triage"
    And I run the pin beat
    When I run gtd next with "--json"
    Then it succeeds
    And I record the json field "memory" as "the design conversation's turn"

    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the widget.
      """
    And gtd lands "gtd(agent): design.triage → seam.naive"
    When I run gtd next with "--json"
    Then it succeeds
    And the json field "memory" differs from the one recorded as "the design conversation's turn"
    And stdout matches "\"memory\":\"seam#[0-9a-f]{7}\""
    And I record the json field "memory" as "the naive pass's turn"

    Given a file "src/widget.ts" with:
      """
      export const widget = () => ({})
      """
    And gtd lands "gtd(agent): seam.naive → implement.building"
    When I run gtd next with "--json"
    Then it succeeds
    And the json field "memory" differs from the one recorded as "the design conversation's turn"
    And the json field "memory" differs from the one recorded as "the naive pass's turn"
    And stdout matches "\"memory\":\"implement#[0-9a-f]{7}\""
    And I record the json field "memory" as "the implement builder's turn"

    Given a file "src/widget.ts" with:
      """
      export const widget = () => Object.freeze({})
      """
    And gtd lands "gtd(agent): implement.building → build.quality.correctness.reviewing"
    When I run gtd next with "--json"
    Then it succeeds
    And the json field "memory" differs from the one recorded as "the implement builder's turn"
    And stdout matches "\"memory\":\"build\.quality\.correctness#[0-9a-f]{7}\""

  Scenario: two agent steps in one memory scope with different models refuse to land — a conversation has one model
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent, human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "start" })
        await agent("draft", "draft it", { model: "smart" })
        await agent("refine", "refine it", { model: "fast" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    And gtd lands "gtd(human): idle → draft"
    And I run the pin beat
    And a file "DRAFT.md" with:
      """
      a draft
      """
    When I run gtd land
    Then it fails
    And stderr contains "runs with a different model, system prompt, skills or file access"
    And stderr contains "a conversation has one identity"

  Scenario: a step-level "memory:" option is rejected at load time — the scope is computed, so there is no authored label to honour or ignore
    # An unknown step option is never silently ignored: it would read as if
    # the authored scope were in effect.
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { agent } from "@pmelab/gtd/flows"

      export default async () => {
        await agent("working", "go", { memory: "plan" })
      }
      """
    When I run gtd next
    Then it fails
    And stderr contains "gtd: config:"
    And stderr contains "unknown key"
    And stderr contains "memory"
