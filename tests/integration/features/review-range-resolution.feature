Feature: Review pointers carry a mandatory range — validated at check, resolved end to end at gtd ui

  Package 04: `.gtd/REVIEW.md`'s file pointers now carry a MANDATORY
  `#start-end` range (see `src/steering/review.ts`), and `gtd ui`'s `diff`
  query resolves that range against a real git diff (`src/ui/Diff.ts`) —
  collecting every hunk the range overlaps, slicing each down to a 3-line pad
  either side, and falling back to a whole-file banner whenever the range
  doesn't land on any hunk, rather than ever rendering an empty body. The two
  `@inmem` scenarios below pin the validator; the `@live` scenarios drive a
  real spawned `gtd ui` against a real git repository.

  @inmem
  Scenario: a pointer with a line but no range produces exactly one finding naming that pointer, and gtd check review exits non-zero
    Given a file "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [ ] ./src/thing.ts#42 — new export
      """
    When I run gtd with args "check review REVIEW.md"
    Then it fails
    And stdout is empty
    And stderr contains "./src/thing.ts#42"

  @inmem
  Scenario: gtd uncheck clears a ticked range pointer back to "- [ ]"
    Given a file "REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [x] ./src/thing.ts#42-70 — new export
      """
    When I run gtd with args "uncheck REVIEW.md"
    Then it succeeds
    And "REVIEW.md" contains "- [ ] ./src/thing.ts#42-70"
    And "REVIEW.md" does not contain "- [x]"

  # ── `gtd ui`'s `diff` query, resolved end to end against a real spawned
  # process (see world.ts#spawnGtdUiAndResolveDiff) — every scenario below
  # rests on the same shape: a human `planning` state with no steering file
  # of its own, so ONLY the render gate (human actor + a `file`) is under
  # test, never a particular mode. ──────────────────────────────────────────

  @live
  Scenario: a pointer into a new file renders only its range plus a 3-line pad, never the whole file
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("planning", { file: "NOTE.md", message: "edit the plan" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And a file "src/big.ts" with:
      """
      export const LINE_01 = 1
      export const LINE_02 = 2
      export const LINE_03 = 3
      export const LINE_04 = 4
      export const LINE_05 = 5
      export const LINE_06 = 6
      export const LINE_07 = 7
      export const LINE_08 = 8
      export const LINE_09 = 9
      export const LINE_10 = 10
      export const LINE_11 = 11
      export const LINE_12 = 12
      export const LINE_13 = 13
      export const LINE_14 = 14
      export const LINE_15 = 15
      export const LINE_16 = 16
      export const LINE_17 = 17
      export const LINE_18 = 18
      export const LINE_19 = 19
      export const LINE_20 = 20
      export const LINE_21 = 21
      export const LINE_22 = 22
      export const LINE_23 = 23
      export const LINE_24 = 24
      export const LINE_25 = 25
      export const LINE_26 = 26
      export const LINE_27 = 27
      export const LINE_28 = 28
      export const LINE_29 = 29
      export const LINE_30 = 30
      export const LINE_31 = 31
      export const LINE_32 = 32
      export const LINE_33 = 33
      export const LINE_34 = 34
      export const LINE_35 = 35
      export const LINE_36 = 36
      export const LINE_37 = 37
      export const LINE_38 = 38
      export const LINE_39 = 39
      export const LINE_40 = 40
      """
    And "src/big.ts" is staged
    When I resolve the diff for "src/big.ts#20-22" via a spawned gtd ui
    Then the diff result is a resolved hunk
    And the diff result carries 1 hunks
    And the diff result's hunk 0 carries 9 lines
    And the diff result's hunk 0 contains "LINE_20"
    And the diff result's hunk 0 does not contain "LINE_01"
    And the diff result's hunk 0 does not contain "LINE_40"

  @live
  Scenario: two pointers into the same new file render two different regions
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("planning", { file: "NOTE.md", message: "edit the plan" })
      }
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And a file "src/big.ts" with:
      """
      export const LINE_01 = 1
      export const LINE_02 = 2
      export const LINE_03 = 3
      export const LINE_04 = 4
      export const LINE_05 = 5
      export const LINE_06 = 6
      export const LINE_07 = 7
      export const LINE_08 = 8
      export const LINE_09 = 9
      export const LINE_10 = 10
      export const LINE_11 = 11
      export const LINE_12 = 12
      export const LINE_13 = 13
      export const LINE_14 = 14
      export const LINE_15 = 15
      export const LINE_16 = 16
      export const LINE_17 = 17
      export const LINE_18 = 18
      export const LINE_19 = 19
      export const LINE_20 = 20
      export const LINE_21 = 21
      export const LINE_22 = 22
      export const LINE_23 = 23
      export const LINE_24 = 24
      export const LINE_25 = 25
      export const LINE_26 = 26
      export const LINE_27 = 27
      export const LINE_28 = 28
      export const LINE_29 = 29
      export const LINE_30 = 30
      export const LINE_31 = 31
      export const LINE_32 = 32
      export const LINE_33 = 33
      export const LINE_34 = 34
      export const LINE_35 = 35
      export const LINE_36 = 36
      export const LINE_37 = 37
      export const LINE_38 = 38
      export const LINE_39 = 39
      export const LINE_40 = 40
      """
    And "src/big.ts" is staged
    When I resolve the diff for "src/big.ts#1-1" via a spawned gtd ui
    Then the diff result's hunk 0 contains "LINE_01"
    And the diff result's hunk 0 does not contain "LINE_20"
    When I resolve the diff for "src/big.ts#38-40" via a spawned gtd ui
    Then the diff result's hunk 0 contains "LINE_40"
    And the diff result's hunk 0 does not contain "LINE_01"

  @live
  Scenario: a range spanning two hunks that git split apart resolves both, not merged into one
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("planning", { file: "NOTE.md", message: "edit the plan" })
      }
      """
    And a commit "chore: add fixture" that adds "src/mid.ts" with:
      """
      export const CTX_01 = 1
      export const CTX_02 = 2
      export const CTX_03 = 3
      export const CTX_04 = 4
      export const CTX_05 = 5
      export const CTX_06 = 6
      export const CTX_07 = 7
      export const CTX_08 = 8
      export const CTX_09 = 9
      export const CTX_10 = 10
      export const CTX_11 = 11
      export const CTX_12 = 12
      export const CTX_13 = 13
      export const CTX_14 = 14
      export const CTX_15 = 15
      export const CTX_16 = 16
      export const CTX_17 = 17
      export const CTX_18 = 18
      export const CTX_19 = 19
      export const CTX_20 = 20
      export const CTX_21 = 21
      export const CTX_22 = 22
      export const CTX_23 = 23
      export const CTX_24 = 24
      export const CTX_25 = 25
      export const CTX_26 = 26
      export const CTX_27 = 27
      export const CTX_28 = 28
      export const CTX_29 = 29
      export const CTX_30 = 30
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And "src/mid.ts" is modified to:
      """
      export const CTX_01 = 1
      export const CTX_02 = 2
      export const CTX_03 = 3
      export const CTX_04 = 4
      export const CTX_05 = 905
      export const CTX_06 = 6
      export const CTX_07 = 7
      export const CTX_08 = 8
      export const CTX_09 = 9
      export const CTX_10 = 10
      export const CTX_11 = 11
      export const CTX_12 = 12
      export const CTX_13 = 13
      export const CTX_14 = 14
      export const CTX_15 = 15
      export const CTX_16 = 16
      export const CTX_17 = 17
      export const CTX_18 = 18
      export const CTX_19 = 19
      export const CTX_20 = 20
      export const CTX_21 = 21
      export const CTX_22 = 22
      export const CTX_23 = 23
      export const CTX_24 = 24
      export const CTX_25 = 925
      export const CTX_26 = 26
      export const CTX_27 = 27
      export const CTX_28 = 28
      export const CTX_29 = 29
      export const CTX_30 = 30
      """
    When I resolve the diff for "src/mid.ts#1-30" via a spawned gtd ui
    Then the diff result carries 2 hunks
    And the diff result's hunk 0 contains "905"
    And the diff result's hunk 0 does not contain "925"
    And the diff result's hunk 1 contains "925"
    And the diff result's hunk 1 does not contain "905"

  @live
  Scenario: a range overlapping nothing renders the whole-file banner, never an empty body
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("planning", { file: "NOTE.md", message: "edit the plan" })
      }
      """
    And a commit "chore: add fixture" that adds "src/mid.ts" with:
      """
      export const CTX_01 = 1
      export const CTX_02 = 2
      export const CTX_03 = 3
      export const CTX_04 = 4
      export const CTX_05 = 5
      export const CTX_06 = 6
      export const CTX_07 = 7
      export const CTX_08 = 8
      export const CTX_09 = 9
      export const CTX_10 = 10
      export const CTX_11 = 11
      export const CTX_12 = 12
      export const CTX_13 = 13
      export const CTX_14 = 14
      export const CTX_15 = 15
      export const CTX_16 = 16
      export const CTX_17 = 17
      export const CTX_18 = 18
      export const CTX_19 = 19
      export const CTX_20 = 20
      export const CTX_21 = 21
      export const CTX_22 = 22
      export const CTX_23 = 23
      export const CTX_24 = 24
      export const CTX_25 = 25
      export const CTX_26 = 26
      export const CTX_27 = 27
      export const CTX_28 = 28
      export const CTX_29 = 29
      export const CTX_30 = 30
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And "src/mid.ts" is modified to:
      """
      export const CTX_01 = 1
      export const CTX_02 = 2
      export const CTX_03 = 3
      export const CTX_04 = 4
      export const CTX_05 = 905
      export const CTX_06 = 6
      export const CTX_07 = 7
      export const CTX_08 = 8
      export const CTX_09 = 9
      export const CTX_10 = 10
      export const CTX_11 = 11
      export const CTX_12 = 12
      export const CTX_13 = 13
      export const CTX_14 = 14
      export const CTX_15 = 15
      export const CTX_16 = 16
      export const CTX_17 = 17
      export const CTX_18 = 18
      export const CTX_19 = 19
      export const CTX_20 = 20
      export const CTX_21 = 21
      export const CTX_22 = 22
      export const CTX_23 = 23
      export const CTX_24 = 24
      export const CTX_25 = 925
      export const CTX_26 = 26
      export const CTX_27 = 27
      export const CTX_28 = 28
      export const CTX_29 = 29
      export const CTX_30 = 30
      """
    When I resolve the diff for "src/mid.ts#15-15" via a spawned gtd ui
    Then the diff result is the whole-file banner

  @live
  Scenario: a pointer into a pure-deletion (whole-file-deleted) hunk renders the whole-file banner, never an empty body
    Given a test project
    And a gtd config file at "gtd.config.ts" with:
      """
      import { human } from "@pmelab/gtd/flows"

      export default async () => {
        await human("idle", { message: "write NOTE.md to start" })
        await human("planning", { file: "NOTE.md", message: "edit the plan" })
      }
      """
    And a commit "chore: add fixture" that adds "src/gone.ts" with:
      """
      line one
      line two
      line three
      """
    And a file "NOTE.md" with:
      """
      a note
      """
    When I run gtd land
    Then it succeeds
    And the file "src/gone.ts" is deleted
    When I resolve the diff for "src/gone.ts#1-1" via a spawned gtd ui
    Then the diff result is the whole-file banner
