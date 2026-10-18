@inmem
Feature: the refactor slice is reviewed on its own before the feature is implemented

  After a refactor-first judgment the refactor is built, quality-lapped and
  reviewed in its own slice. Review edits re-run the refactor, never the design;
  the feature review that follows covers only what came after the refactor's
  sign-off. The flags are pinned so the per-flag test runs never move it off
  its path.

  Background:
    Given the shipped workflows, as gtd install scaffolds them
    And an environment variable "GTD_QUALITYREVIEWS" set to ""
    And an environment variable "GTD_FLAG_NAIVE_PASS" set to "1"
    And an environment variable "GTD_FLAG_RISK_TIER" set to "0"

  Scenario: with a narrowed seamAllow a test-named file written by the refactor is refused
    Given an environment variable "GTD_REFACTORQUALITYREVIEWS" set to ""
    And an environment variable "GTD_SEAMALLOW" set to "docs/**"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/calc.test.ts" with:
      """
      import { expect, it } from "vitest"
      it("adds", () => expect(1 + 1).toBe(2))
      """
    And a file "src/*.ts" with:
      """
      export const literalGlobName = 1
      """
    And the working tree is committed as "feat: add calculator"
    And a file "TODO.md" with:
      """
      # Add subtract

      subtract(a, b) returns the difference.
      """
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Concerns

      ### Subtract

      - `subtract(a, b)` returns `a - b`.
      """
    And step "design.gate.answer" changes nothing
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    And step "refactor.deriving" runs its script
    And step "refactor.building" writes "src/calc.ts" with:
      """
      export const op = (a: number, b: number, sign: number) => a + sign * b
      export const add = (a: number, b: number) => op(a, b, 1)
      """
    And step "refactor.health.check" changes nothing
    And step "refactor.closing" runs its script
    And step "refactor.build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-2
        add built on the shared op
      """
    And step "refactor.build.review.closing" runs its script


    And step "seam.naive" writes "src/calc.test.ts" with:
      """
      import { expect, it } from "vitest"
      it("adds", () => expect(2 + 2).toBe(4))
      """
    And step "refactor.building" writes "src/calc.test.ts" with:
      """
      import { expect, it } from "vitest"
      it("adds", () => expect(3 + 3).toBe(6))
      """
    Then driving the process is refused with "outside its write access"


  Scenario: refactorQualityReviews picks the refactor's lenses and qualityReviews does not reach them
    Given an environment variable "GTD_REFACTORQUALITYREVIEWS" set to "correctness"
    And an environment variable "GTD_QUALITYREVIEWS" set to "owasp-security"
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/calc.test.ts" with:
      """
      import { expect, it } from "vitest"
      it("adds", () => expect(1 + 1).toBe(2))
      """
    And a file "src/*.ts" with:
      """
      export const literalGlobName = 1
      """
    And the working tree is committed as "feat: add calculator"
    And a file "TODO.md" with:
      """
      # Add subtract

      subtract(a, b) returns the difference.
      """
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
      """
      # Requirements

      ## Concerns

      ### Subtract

      - `subtract(a, b)` returns `a - b`.
      """
    And step "design.gate.answer" changes nothing
    And step "seam.naive" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      export const subtract = (a: number, b: number) => a - b
      """
    And judge step "seam.judge" answers:
      """
      [{"id":"shape","answer":"refactor-first","p":0.9}]
      """
    And step "refactor.deriving" runs its script
    And step "refactor.building" writes "src/calc.ts" with:
      """
      export const op = (a: number, b: number, sign: number) => a + sign * b
      export const add = (a: number, b: number) => op(a, b, 1)
      """
    And step "refactor.health.check" changes nothing
    And step "refactor.closing" runs its script
    And step "refactor.build.review.reviewing" writes ".gtd/REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: 0000000 -->

      ## calc

      - [ ] ./src/calc.ts#1-2
        add built on the shared op
      """
    And step "refactor.build.review.closing" runs its script


    And step "refactor.build.quality.correctness.reviewing" changes nothing
    When the process is driven
    Then the process rests at "refactor.build.review.await-review"
    And the commit subjects end with:
      """
      gtd(check): refactor.closing → refactor.build.quality.correctness.reviewing
      gtd(agent): refactor.build.quality.correctness.reviewing → refactor.build.review.reviewing
      gtd(agent): refactor.build.review.reviewing → refactor.build.review.await-review
      """


  Rule: with the refactor lenses blank

    Background:
      Given an environment variable "GTD_REFACTORQUALITYREVIEWS" set to ""
      And a file "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        """
      And a file "src/calc.test.ts" with:
        """
        import { expect, it } from "vitest"
        it("adds", () => expect(1 + 1).toBe(2))
        """
      And a file "src/*.ts" with:
        """
        export const literalGlobName = 1
        """
      And the working tree is committed as "feat: add calculator"
      And a file "TODO.md" with:
        """
        # Add subtract

        subtract(a, b) returns the difference.
        """
      And step "unwind" changes nothing
      And step "start-gate.check" changes nothing
      And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Concerns

        ### Subtract

        - `subtract(a, b)` returns `a - b`.
        """
      And step "design.gate.answer" changes nothing
      And step "seam.naive" writes "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        export const subtract = (a: number, b: number) => a - b
        """
      And judge step "seam.judge" answers:
        """
        [{"id":"shape","answer":"refactor-first","p":0.9}]
        """
      And step "refactor.deriving" runs its script
      And step "refactor.building" writes "src/calc.ts" with:
        """
        export const op = (a: number, b: number, sign: number) => a + sign * b
        export const add = (a: number, b: number) => op(a, b, 1)
        """
      And step "refactor.health.check" changes nothing
      And step "refactor.closing" runs its script
      And step "refactor.build.review.reviewing" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op
        """
      And step "refactor.build.review.closing" runs its script

    Scenario: an edit note at the refactor review re-derives the refactor, never the design
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op[^why]

        [^why]:
            - H: name the helper `combine`
        """
      And step "refactor.build.review.collecting" writes ".gtd/REFACTOR.md" with:
        """
        Name the shared helper `combine`.
        """
      And step "refactor.build.review.collecting" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op[^why]

        [^why]:
            - H: name the helper `combine`
            - A: noted in the refactor package.
        """
      When gtd lands
      And the process is driven
      Then the process rests at "refactor.build.review.await-review"
      And ".gtd/REFACTOR.md" contains "combine"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op
        """
      And step "refactor.re-unwind" runs its script
      And step "refactor.building" writes "src/calc.ts" with:
        """
        export const combine = (a: number, b: number, sign: number) => a + sign * b
        export const add = (a: number, b: number) => combine(a, b, 1)
        """
      And step "refactor.deriving" is prompted with "Review feedback"
      When gtd lands
      And the process is driven
      Then the process rests at "refactor.build.review.await-review"
      And the commit subjects end with:
        """
        gtd(human): refactor.build.review.await-review → refactor.build.review.closing
        gtd(check): refactor.build.review.closing → refactor.re-unwind
        gtd(check): refactor.re-unwind → refactor.deriving
        gtd(check): refactor.deriving → refactor.building
        gtd(agent): refactor.building → refactor.health.check
        gtd(check): refactor.health.check → refactor.closing
        gtd(check): refactor.closing → refactor.build.review.reviewing
        gtd(agent): refactor.build.review.reviewing → refactor.build.review.await-review
        """

    Scenario: a question answered at the refactor review reaches the re-derived package as ### Answered Questions
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-1
          why a shared op?
        - [ ] ./src/calc.ts#2-2
          rename the helper to combine
        """
      And judge step "refactor.build.review.triage" answers:
        """
        [{"id":"note-1","answer":"question","p":0.9},{"id":"note-2","answer":"edit","p":0.9}]
        """
      And step "refactor.build.review.answer-review-questions" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-1
          why a shared op?
          A: add and subtract differ only by sign.
        - [ ] ./src/calc.ts#2-2
          rename the helper to combine
        """
      And step "refactor.build.review.collecting" writes ".gtd/REFACTOR.md" with:
        """
        ## Rename

        Name the shared helper `combine`.

        ## Answered Questions

        ### why a shared op?

        add and subtract differ only by sign.
        """
      And step "refactor.re-unwind" runs its script
      And step "refactor.deriving" runs its script
      When gtd lands
      And the process is driven
      Then ".gtd/REFACTOR.md" contains "## Review feedback"
      And ".gtd/REFACTOR.md" contains "### Answered Questions"

    Scenario: a human code edit at the refactor review is reverted by refactor.re-unwind
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file "src/calc.ts" with:
        """
        export const op = (a: number, b: number, sign: number) => a + sign * b
        export const add = (a: number, b: number) => op(a, b, 1)
        // TODO: rename op to adjust
        """
      And step "refactor.build.review.collecting" writes ".gtd/REFACTOR.md" with:
        """
        Rename op to adjust in the shared helper.
        """
      And step "refactor.re-unwind" runs its script
      And step "refactor.building" writes "src/calc.ts" with:
        """
        export const adjust = (a: number, b: number, sign: number) => a + sign * b
        export const add = (a: number, b: number) => adjust(a, b, 1)
        """
      When gtd lands
      And the process is driven
      Then the process rests at "refactor.build.review.await-review"
      And "src/calc.ts" does not contain "TODO"
      And the commit subjects end with:
        """
        gtd(human): refactor.build.review.await-review → refactor.build.review.closing
        gtd(check): refactor.build.review.closing → refactor.build.review.collecting
        gtd(agent): refactor.build.review.collecting → refactor.re-unwind
        gtd(check): refactor.re-unwind → refactor.deriving
        gtd(check): refactor.deriving → refactor.building
        gtd(agent): refactor.building → refactor.health.check
        gtd(check): refactor.health.check → refactor.closing
        gtd(check): refactor.closing → refactor.build.review.reviewing
        gtd(agent): refactor.build.review.reviewing → refactor.build.review.await-review
        """

    Scenario: an edit note the collecting turn leaves out refuses the landing and never signs off
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op — this should change behaviour, not just structure
        """
      And judge step "refactor.build.review.triage" answers:
        """
        [{"id":"note-1","answer":"edit","p":0.9}]
        """
      And step "refactor.build.review.collecting" changes nothing
      When gtd lands
      Then driving the process is refused with "refactor-feedback"
      And driving the process is refused with "note-1"
      And driving the process is refused with "gtd abandon"

    Scenario: a code hand-edit the collecting turn leaves out refuses the landing naming the path
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file "src/calc.ts" with:
        """
        export const op = (a: number, b: number, sign: number) => a + sign * b
        export const add = (a: number, b: number) => op(a, b, 1)
        // TODO: rename op to adjust
        """
      And step "refactor.build.review.collecting" changes nothing
      When gtd lands
      Then driving the process is refused with "refactor-feedback"
      And driving the process is refused with "src/calc.ts"

    Scenario: a praise line note on a hand-edit round is never named by the refusal
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file "src/calc.ts" with:
        """
        export const op = (a: number, b: number, sign: number) => a + sign * b
        export const add = (a: number, b: number) => op(a, b, 1)
        // TODO: rename op to adjust
        """
      And a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op, lovely work
        """
      And step "refactor.build.review.collecting" changes nothing
      When gtd lands
      Then driving the process is refused with "hand-edited src/calc.ts"
      And driving the process is refused without "lovely work"

    Scenario: a thread question at the refactor review gets one reply and no refactor package
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op[^q]

        [^q]:
            - H: why a shared op?
        """
      And step "refactor.build.review.collecting" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op[^q]

        [^q]:
            - H: why a shared op?
            - A: add and subtract differ only by sign.
        """
      When gtd lands
      And the process is driven
      Then the process rests at "refactor.build.review.await-review"
      And ".gtd/REFACTOR.md" does not exist
      And ".gtd/REVIEW.md" contains "A: add and subtract differ only by sign."

    Scenario: a no-change landing after the in-gate reply signs off and the feature slice follows
      Given step "implement.building" writes "src/calc.ts" with:
        """
        export const op = (a: number, b: number, sign: number) => a + sign * b
        export const add = (a: number, b: number) => op(a, b, 1)
        export const subtract = (a: number, b: number) => op(a, b, -1)
        """
      And step "implement.health.check" changes nothing
      And step "implement.closing" runs its script
      And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-3
          subtract built on the shared op
        """
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op[^q]

        [^q]:
            - H: why a shared op?
        """
      And step "refactor.build.review.collecting" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op[^q]

        [^q]:
            - H: why a shared op?
            - A: add and subtract differ only by sign.
        """
      When gtd lands
      And the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op[^q]

        [^q]:
            - H: why a shared op?
            - A: add and subtract differ only by sign.
            - H: understood, thanks. No change needed.
        """
      And step "refactor.build.review.collecting" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op
        """
      When gtd lands
      And the process is driven
      Then the process rests at "build.review.await-review"

    Scenario: a praise-only one-shot footnote signs off and the feature slice follows
      Given step "implement.building" writes "src/calc.ts" with:
        """
        export const op = (a: number, b: number, sign: number) => a + sign * b
        export const add = (a: number, b: number) => op(a, b, 1)
        export const subtract = (a: number, b: number) => op(a, b, -1)
        """
      And step "implement.health.check" changes nothing
      And step "implement.closing" runs its script
      And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-3
          subtract built on the shared op
        """
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op[^n1]

        [^n1]:
            Lovely helper.
        """
      And judge step "refactor.build.review.triage" answers:
        """
        [{"id":"note-1","answer":"praise","p":0.9}]
        """
      When gtd lands
      And the process is driven
      Then the process rests at "build.review.await-review"

    Scenario: a one-shot footnote judged edit that collecting leaves out refuses naming its anchor
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op[^n1]

        [^n1]:
            Rename the helper.
        """
      And judge step "refactor.build.review.triage" answers:
        """
        [{"id":"note-1","answer":"edit","p":0.9}]
        """
      And step "refactor.build.review.collecting" changes nothing
      When gtd lands
      Then driving the process is refused with "refactor-feedback"
      And driving the process is refused with "[^n1]"
      And driving the process is refused with "Rename the helper."

    Scenario: a one-shot footnote landed after an in-gate thread reply is judged, not signed off unjudged
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op[^q]

        [^q]:
            - H: why a shared op?
        """
      And step "refactor.build.review.collecting" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op[^q]

        [^q]:
            - H: why a shared op?
            - A: add and subtract differ only by sign.
        """
      When gtd lands
      And the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op[^n1]

        [^n1]:
            Rename the helper.
        """
      And judge step "refactor.build.review.triage" answers:
        """
        [{"id":"note-1","answer":"edit","p":0.9}]
        """
      And step "refactor.build.review.collecting" from now on changes nothing
      When gtd lands
      Then driving the process is refused with "refactor-feedback"
      And driving the process is refused with "[^n1]"

    Scenario: a praise-only refactor review still signs off and the feature slice follows
      Given step "implement.building" writes "src/calc.ts" with:
        """
        export const op = (a: number, b: number, sign: number) => a + sign * b
        export const add = (a: number, b: number) => op(a, b, 1)
        export const subtract = (a: number, b: number) => op(a, b, -1)
        """
      And step "implement.health.check" changes nothing
      And step "implement.closing" runs its script
      And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-3
          subtract built on the shared op
        """
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [x] ./src/calc.ts#1-2
          add built on the shared op
        """
      When gtd lands
      And the process is driven
      Then the process rests at "build.review.await-review"

    Scenario: the feature review after a refactor covers only the commits since the refactor's sign-off
      Given step "implement.building" writes "src/calc.ts" with:
        """
        export const op = (a: number, b: number, sign: number) => a + sign * b
        export const add = (a: number, b: number) => op(a, b, 1)
        export const subtract = (a: number, b: number) => op(a, b, -1)
        """
      And step "implement.health.check" changes nothing
      And step "implement.closing" runs its script
      And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-3
          subtract built on the shared op
        """
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [x] ./src/calc.ts#1-2
          add built on the shared op
        """
      When gtd lands
      And the process is driven
      Then the process rests at "build.review.await-review"
      And the resting step's content contains the hash of the commit "gtd(check): refactor.build.review.closing → implement.building"

    Scenario: feature feedback after a refactor re-plans design and implement, never the seam phase
      Given step "implement.building" writes "src/calc.ts" with:
        """
        export const op = (a: number, b: number, sign: number) => a + sign * b
        export const add = (a: number, b: number) => op(a, b, 1)
        export const subtract = (a: number, b: number) => op(a, b, -1)
        """
      And step "implement.health.check" changes nothing
      And step "implement.closing" runs its script
      And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-3
          subtract built on the shared op
        """
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [x] ./src/calc.ts#1-2
          add built on the shared op
        """
      When gtd lands
      And the process is driven
      Then the process rests at "build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-3
          subtract built on the shared op[^why]

        [^why]:
            - H: also export multiply
        """
      And step "build.review.collecting" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Concerns

        ### Multiply

        - Export `multiply()`.
        """
      And step "build.review.collecting" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-3
          subtract built on the shared op[^why]

        [^why]:
            - H: also export multiply
            - A: noted in the requirements.
        """
      When gtd lands
      And the process is driven
      Then the process rests at "build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-3
          subtract built on the shared op
        """
      And step "build.review.closing" runs its script
      And step "re-unwind" runs its script
      When gtd lands
      And the process is driven
      Then the process rests at "implement.building"
      And the commit subjects end with:
        """
        gtd(check): re-unwind → design.triage
        gtd(agent): design.triage → design.gate.answer
        gtd(human): design.gate.answer → implement.building
        gtd(agent): implement.building
        """

    Scenario: a nit fix in the refactor slice that changes a non-stray is refused, though a glob stray widens the write access
      Given step "seam.naive" writes "src/*.ts" with:
        """
        export const literalGlobName = 2
        """
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op — rename `sign` to `direction`
        """
      And judge step "refactor.build.review.triage" answers:
        """
        [{"id":"note-1","answer":"nit","p":0.9}]
        """
      And step "refactor.build.review.fix.nits.fixing" writes "src/other.ts" with:
        """
        export const other = 1
        """
      When gtd lands
      Then driving the process is refused with "refactor-scope"

    Scenario: the nit-fix turn in the refactor slice may write the strays and .gtd/** only
      Given step "seam.naive" writes "src/*.ts" with:
        """
        export const literalGlobName = 2
        """
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op — rename `sign` to `direction`
        """
      And judge step "refactor.build.review.triage" answers:
        """
        [{"id":"note-1","answer":"nit","p":0.9}]
        """
      When gtd lands
      And the process is driven
      Then the process rests at "refactor.build.review.fix.nits.fixing"
      And the output of gtd "next --json=access.write" contains "src/*.ts"
      And the output of gtd "next --json=access.write" contains ".gtd/**"

    Scenario: a blank refactorQualityReviews runs no refactor quality lap
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      And the commit subjects end with:
        """
        gtd(check): refactor.closing → refactor.build.review.reviewing
        gtd(agent): refactor.build.review.reviewing → refactor.build.review.await-review
        """

  Rule: with a quality lens on both slices

    Background:
      Given an environment variable "GTD_REFACTORQUALITYREVIEWS" set to "correctness"
      And an environment variable "GTD_QUALITYREVIEWS" set to "correctness"
      And a file "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        """
      And a file "src/calc.test.ts" with:
        """
        import { expect, it } from "vitest"
        it("adds", () => expect(1 + 1).toBe(2))
        """
      And a file "src/*.ts" with:
        """
        export const literalGlobName = 1
        """
      And the working tree is committed as "feat: add calculator"
      And a file "TODO.md" with:
        """
        # Add subtract

        subtract(a, b) returns the difference.
        """
      And step "unwind" changes nothing
      And step "start-gate.check" changes nothing
      And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Concerns

        ### Subtract

        - `subtract(a, b)` returns `a - b`.
        """
      And step "design.gate.answer" changes nothing
      And step "seam.naive" writes "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        export const subtract = (a: number, b: number) => a - b
        """
      And judge step "seam.judge" answers:
        """
        [{"id":"shape","answer":"refactor-first","p":0.9}]
        """
      And step "refactor.deriving" runs its script
      And step "refactor.building" writes "src/calc.ts" with:
        """
        export const op = (a: number, b: number, sign: number) => a + sign * b
        export const add = (a: number, b: number) => op(a, b, 1)
        """
      And step "refactor.health.check" changes nothing
      And step "refactor.closing" runs its script
      And step "refactor.build.review.reviewing" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op
        """
      And step "refactor.build.review.closing" runs its script

    Scenario: each slice's quality lap reviews from that slice's base, before and after a feature feedback lap
      When the process is driven
      Then the process rests at "refactor.build.quality.correctness.reviewing"
      And the resting step's content contains the hash of the commit "gtd(judge): seam.judge → refactor.deriving"
      Given step "refactor.build.quality.correctness.reviewing" changes nothing
      And step "implement.building" writes "src/calc.ts" with:
        """
        export const op = (a: number, b: number, sign: number) => a + sign * b
        export const add = (a: number, b: number) => op(a, b, 1)
        export const subtract = (a: number, b: number) => op(a, b, -1)
        """
      And step "implement.health.check" changes nothing
      And step "implement.closing" runs its script
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [x] ./src/calc.ts#1-2
          add built on the shared op
        """
      When gtd lands
      And the process is driven
      Then the process rests at "build.quality.correctness.reviewing"
      And the resting step's content contains the hash of the commit "gtd(check): refactor.build.review.closing → implement.building"
      Given step "build.quality.correctness.reviewing" changes nothing
      And step "build.review.reviewing" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-3
          subtract built on the shared op
        """
      When the process is driven
      Then the process rests at "build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-3
          subtract built on the shared op[^why]

        [^why]:
            - H: also export multiply
        """
      And step "build.review.collecting" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Concerns

        ### Multiply

        - Export `multiply()`.
        """
      And step "build.review.collecting" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-3
          subtract built on the shared op[^why]

        [^why]:
            - H: also export multiply
            - A: noted in the requirements.
        """
      When gtd lands
      And the process is driven
      Then the process rests at "build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-3
          subtract built on the shared op
        """
      And step "build.review.closing" runs its script
      And step "re-unwind" runs its script
      And step "build.quality.correctness.reviewing" is no longer scripted
      And step "implement.building" writes "src/calc.ts" with:
        """
        export const op = (a: number, b: number, sign: number) => a + sign * b
        export const add = (a: number, b: number) => op(a, b, 1)
        export const subtract = (a: number, b: number) => op(a, b, -1)
        export const multiply = (a: number, b: number) => a * b
        """
      And step "implement.health.check" changes nothing
      And step "implement.closing" runs its script
      When gtd lands
      And the process is driven
      Then the process rests at "build.quality.correctness.reviewing"
      And the resting step's content contains the hash of the commit "gtd(check): refactor.build.review.closing → implement.building"

  Rule: a refactor package never carries a test file, and demoted headings stop at ######

    Background:
      Given an environment variable "GTD_REFACTORQUALITYREVIEWS" set to ""
      And an environment variable "GTD_SEAMALLOW" set to "docs/**"
      And a file "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        """
      And a file "src/calc.test.ts" with:
        """
        import { expect, it } from "vitest"
        it("adds", () => expect(1 + 1).toBe(2))
        """
      And the working tree is committed as "feat: add calculator"
      And a file "TODO.md" with:
        """
        # Add subtract

        subtract(a, b) returns the difference.
        """
      And step "unwind" changes nothing
      And step "start-gate.check" changes nothing
      And step "design.triage" writes ".gtd/REQUIREMENTS.md" with:
        """
        # Requirements

        ## Concerns

        ### Subtract

        - `subtract(a, b)` returns `a - b`.
        """
      And step "design.gate.answer" changes nothing
      And judge step "seam.judge" answers:
        """
        [{"id":"shape","answer":"refactor-first","p":0.9}]
        """

    Scenario: a test-file stray is dropped from the derived refactor package
      Given step "seam.naive" writes "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        export const subtract = (a: number, b: number) => a - b
        """
      And step "seam.naive" writes "src/calc.test.ts" with:
        """
        import { expect, it } from "vitest"
        it("subtracts", () => expect(3 - 1).toBe(2))
        """
      And step "refactor.deriving" runs its script
      When the process is driven
      Then the process rests at "refactor.building"
      And ".gtd/REFACTOR.md" contains "src/calc.ts"
      And ".gtd/REFACTOR.md" does not contain "src/calc.test.ts"

    Scenario: a refactor-first whose strays are all test files goes straight to implement
      Given step "seam.naive" writes "src/calc.test.ts" with:
        """
        import { expect, it } from "vitest"
        it("subtracts", () => expect(3 - 1).toBe(2))
        """
      When the process is driven
      Then the process rests at "implement.building"
      And ".gtd/REFACTOR.md" does not exist

    Scenario: collected review headings re-derive at ### with the deepest capped at ######
      Given step "seam.naive" writes "src/calc.ts" with:
        """
        export const add = (a: number, b: number) => a + b
        export const subtract = (a: number, b: number) => a - b
        """
      And step "refactor.deriving" runs its script
      And step "refactor.building" writes "src/calc.ts" with:
        """
        export const op = (a: number, b: number, sign: number) => a + sign * b
        export const add = (a: number, b: number) => op(a, b, 1)
        """
      And step "refactor.health.check" changes nothing
      And step "refactor.closing" runs its script
      And step "refactor.build.review.reviewing" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op
        """
      When the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op[^why]

        [^why]:
            - H: name the helper `combine`
        """
      And step "refactor.build.review.collecting" writes ".gtd/REFACTOR.md" with:
        """
        # Rename

        ##### Detail

        Name the shared helper `combine`.
        """
      And step "refactor.build.review.collecting" writes ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op[^why]

        [^why]:
            - H: name the helper `combine`
            - A: noted in the refactor package.
        """
      When gtd lands
      And the process is driven
      Then the process rests at "refactor.build.review.await-review"
      Given a file ".gtd/REVIEW.md" with:
        """
        # Review: abc1234

        <!-- base: 0000000 -->

        ## calc

        - [ ] ./src/calc.ts#1-2
          add built on the shared op
        """
      And step "refactor.build.review.closing" runs its script
      And step "refactor.re-unwind" runs its script
      And step "refactor.building" is no longer scripted
      When gtd lands
      And the process is driven
      Then the process rests at "refactor.building"
      And ".gtd/REFACTOR.md" contains "## Review feedback"
      And ".gtd/REFACTOR.md" contains "### Rename"
      And ".gtd/REFACTOR.md" contains "###### Detail"
