Feature: rollout turns one release flag default-on and touches nothing else

  `gtd --workflow rollout --var flag=<name>` has an agent set `defaultOn: true`
  on the named registry entry; a check refuses any other change, and a red
  suite rests at a human gate — never a fix turn.

  Background:
    Given a gtd config with:
      """
      export {
        feature as default,
        feature,
        defaults,
        envDefaults,
        summary,
        steering,
        skills,
        access,
      } from "@pmelab/gtd/workflows/feature"
      import { rollout } from "@pmelab/gtd/workflows"
      export { rollout }
      export const elsewhere = rollout({ flagRegistry: "config/flags.ts" })
      """
    And a file "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release" },
        { name: "beta", owner: "b", expiry: "2027-02-01", kind: "release" },
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    And the working tree is committed as "feat: registry"

  Scenario: a flip of the named entry lands, the suite passes and the process ends
    Given step "rollout.flipping" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release", defaultOn: true },
        { name: "beta", owner: "b", expiry: "2027-02-01", kind: "release" },
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    And step "rollout.suite.check" changes nothing
    And step "rollout.mentions" runs its script
    When gtd starts workflow "rollout" with "--var flag=alpha"
    And the process is driven
    Then the process rests at "idle"
    And "src/flags/index.ts" contains "kind: \"release\", defaultOn: true },"
    And the commit subjects end with:
      """
      gtd(check): rollout.suite.check → rollout.mentions
      gtd(check): rollout.mentions → idle
      """

  Scenario: a turn also changing a source file is refused naming that path
    Given step "rollout.flipping" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release", defaultOn: true },
        { name: "beta", owner: "b", expiry: "2027-02-01", kind: "release" },
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    And step "rollout.flipping" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => b + a
      """
    When gtd starts workflow "rollout" with "--var flag=alpha"
    Then driving the process is refused with "rollout-only: src/calc.ts changed"

  Scenario: a turn editing a second registry entry is refused
    Given step "rollout.flipping" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release", defaultOn: true },
        { name: "beta", owner: "zed", expiry: "2027-02-01", kind: "release" },
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    When gtd starts workflow "rollout" with "--var flag=alpha"
    Then driving the process is refused with "other edits in src/flags/index.ts"

  Scenario: a factory flagRegistry names the one file the guard allows
    Given a file "config/flags.ts" with:
      """
      export const FLAGS = [
        { name: "gamma", owner: "g", expiry: "2027-05-01", kind: "release" },
      ] as const
      """
    And the working tree is committed as "feat: second registry"
    And step "rollout.flipping" writes "config/flags.ts" with:
      """
      export const FLAGS = [
        { name: "gamma", owner: "g", expiry: "2027-05-01", kind: "release", defaultOn: true },
      ] as const
      """
    And step "rollout.suite.check" changes nothing
    And step "rollout.mentions" runs its script
    When gtd starts workflow "elsewhere" with "--var flag=gamma"
    And the process is driven
    Then the process rests at "idle"
    And "config/flags.ts" contains "defaultOn: true"

  @inmem
  Scenario: gtd door rollout starts the rollout of its flag argument
    Given step "rollout.flipping" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release", defaultOn: true },
        { name: "beta", owner: "b", expiry: "2027-02-01", kind: "release" },
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    And step "rollout.suite.check" changes nothing
    And step "rollout.mentions" runs its script
    When gtd opens door "rollout" with "alpha"
    And the process is driven
    Then the process rests at "idle"
    And "src/flags/index.ts" contains "kind: \"release\", defaultOn: true },"

  @inmem
  Scenario: gtd door rollout with no argument is refused naming the flag
    Then opening door "rollout" is refused with "usage: gtd door rollout <flag>"

  Scenario: a missing flag var is refused before any turn
    Then starting workflow "rollout" with "" is refused with "gtd: rollout needs --var flag=<name>"

  Scenario: an unknown flag is refused before any turn
    Then starting workflow "rollout" with "--var flag=nope" is refused with "no flag \"nope\" in src/flags/index.ts"

  Scenario: an ops flag is refused before any turn
    Then starting workflow "rollout" with "--var flag=ops1" is refused with "flag \"ops1\" is ops, not release"

  Scenario: an already default-on flag is refused before any turn
    Then starting workflow "rollout" with "--var flag=live" is refused with "flag \"live\" is already default-on"

  Scenario: a red suite after the flip rests at the blocked gate with no fix turn
    Given step "rollout.flipping" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release", defaultOn: true },
        { name: "beta", owner: "b", expiry: "2027-02-01", kind: "release" },
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    And step "rollout.suite.check" writes ".gtd/FEEDBACK.md" with:
      """
      1 test failing
      """
    When gtd starts workflow "rollout" with "--var flag=alpha"
    And the process is driven
    Then the process rests at "rollout.suite.blocked"

  @inmem
  Scenario: a human fix at the blocked gate that also edits a source file is refused
    Given step "rollout.flipping" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release", defaultOn: true },
        { name: "beta", owner: "b", expiry: "2027-02-01", kind: "release" },
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    And step "rollout.suite.check" writes ".gtd/FEEDBACK.md" with:
      """
      1 test failing
      """
    When gtd starts workflow "rollout" with "--var flag=alpha"
    And the process is driven
    Then the process rests at "rollout.suite.blocked"
    And step "rollout.suite.blocked" writes "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => b + a
      """
    Then driving the process is refused with "rollout-only: src/calc.ts changed"

  @inmem
  Scenario: a human fix at the blocked gate that edits a second registry entry is refused
    Given step "rollout.flipping" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release", defaultOn: true },
        { name: "beta", owner: "b", expiry: "2027-02-01", kind: "release" },
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    And step "rollout.suite.check" writes ".gtd/FEEDBACK.md" with:
      """
      1 test failing
      """
    When gtd starts workflow "rollout" with "--var flag=alpha"
    And the process is driven
    Then the process rests at "rollout.suite.blocked"
    And step "rollout.suite.blocked" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release", defaultOn: true },
        { name: "beta", owner: "zed", expiry: "2027-02-01", kind: "release" },
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    Then driving the process is refused with "other edits in src/flags/index.ts"

  @inmem
  Scenario: a human fix touching only the feedback file lands and the process ends with no review
    Given step "rollout.flipping" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release", defaultOn: true },
        { name: "beta", owner: "b", expiry: "2027-02-01", kind: "release" },
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    And step "rollout.suite.check" writes ".gtd/FEEDBACK.md" with:
      """
      1 test failing
      """
    When gtd starts workflow "rollout" with "--var flag=alpha"
    And the process is driven
    Then the process rests at "rollout.suite.blocked"
    And step "rollout.suite.blocked" writes ".gtd/FEEDBACK.md" with:
      """
      fixed by hand
      """
    And step "rollout.suite.check" from now on changes nothing
    And step "rollout.mentions" runs its script
    When the process is driven
    Then the process rests at "idle"
    And the commit subjects end with:
      """
      gtd(check): rollout.suite.check → rollout.mentions
      gtd(check): rollout.mentions → idle
      """

  @inmem
  Scenario: every line naming the flag is listed, no file is edited, and gtd summary repeats the list
    Given a file "README.md" with:
      """
      # calc

      The alpha formatter is on under GTD_FLAG_ALPHA=1.
      """
    And a file "src/calc.ts" with:
      """
      export const help = "pass --flag_alpha to enable the alpha formatter"
      """
    And the working tree is committed as "docs: mention the flag"
    And step "rollout.flipping" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release", defaultOn: true },
        { name: "beta", owner: "b", expiry: "2027-02-01", kind: "release" },
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    And step "rollout.suite.check" changes nothing
    And step "rollout.mentions" runs its script
    When gtd starts workflow "rollout" with "--var flag=alpha"
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/FEEDBACK.md" does not exist
    And "README.md" contains "The alpha formatter is on under GTD_FLAG_ALPHA=1."
    And "src/calc.ts" contains "pass --flag_alpha to enable the alpha formatter"
    And the output of gtd "summary" contains "`README.md:3`"
    And the output of gtd "summary" contains "src/calc.ts:1"

  @inmem
  Scenario: a flag named nowhere outside the registry says so in gtd summary
    Given step "rollout.flipping" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release", defaultOn: true },
        { name: "beta", owner: "b", expiry: "2027-02-01", kind: "release" },
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    And step "rollout.suite.check" changes nothing
    And step "rollout.mentions" runs its script
    When gtd starts workflow "rollout" with "--var flag=alpha"
    And the process is driven
    Then the process rests at "idle"
    And ".gtd/FEEDBACK.md" does not exist
    And the output of gtd "summary" contains "no line outside the registry names it"

  @inmem
  Scenario: the closing commit marks the total and each listed line
    Given a file "README.md" with:
      """
      # calc

      The alpha formatter is on under GTD_FLAG_ALPHA=1.
      """
    And a file "src/calc.ts" with:
      """
      export const help = "pass --flag_alpha to enable the alpha formatter"
      """
    And the working tree is committed as "docs: mention the flag"
    And step "rollout.flipping" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release", defaultOn: true },
        { name: "beta", owner: "b", expiry: "2027-02-01", kind: "release" },
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    And step "rollout.suite.check" changes nothing
    And step "rollout.mentions" runs its script
    When gtd starts workflow "rollout" with "--var flag=alpha"
    And the process is driven
    Then the last commit subject is "gtd(check): rollout.mentions → idle"
    And the last commit body contains "Gtd-Mark: flag-mentions=2"
    And the last commit body contains "Gtd-Mark: flag-mention=README.md:3"
    And the last commit body contains "Gtd-Mark: flag-mention=src/calc.ts:1"

  @inmem
  Scenario: a finished rollout leaves no state file for the next feature start
    Given a file "README.md" with:
      """
      # calc

      The alpha formatter is on under GTD_FLAG_ALPHA=1.
      """
    And a file "src/calc.ts" with:
      """
      export const help = "pass --flag_alpha to enable the alpha formatter"
      """
    And the working tree is committed as "docs: mention the flag"
    And step "rollout.flipping" writes "src/flags/index.ts" with:
      """
      export const FLAGS = [
        { name: "alpha", owner: "a", expiry: "2027-01-01", kind: "release", defaultOn: true },
        { name: "beta", owner: "b", expiry: "2027-02-01", kind: "release" },
        { name: "ops1", owner: "c", expiry: "2027-03-01", kind: "ops" },
        { name: "live", owner: "d", expiry: "2027-04-01", kind: "release", defaultOn: true },
      ] as const
      """
    And step "rollout.suite.check" changes nothing
    And step "rollout.mentions" runs its script
    And step "unwind" changes nothing
    And step "start-gate.check" changes nothing
    When gtd starts workflow "rollout" with "--var flag=alpha"
    And the process is driven
    Then the process rests at "idle"
    Given a file "TODO.md" with:
      """
      # Add subtract

      subtract(a, b) returns the difference.
      """
    When the process is driven
    Then the process rests at "design.triage"
    And ".gtd/FEEDBACK.md" does not exist
