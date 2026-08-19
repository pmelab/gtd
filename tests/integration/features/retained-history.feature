@inmem
Feature: gtd restore — undo a squash (or an abandon) by hard-resetting to the retained tip

  A squash collapses a whole process's turn commits into one, and `gtd abandon`
  rewinds a process still underway — both retain the pre-collapse tip on
  `refs/worktree/gtd/history` (see `src/RetainedHistory.ts`) before they act.
  `gtd restore` is the way back: it hard-resets HEAD to that retained tip and
  clears the ref, bringing the turn-by-turn history back (or re-applying an
  abandon's own rewind).

  It is guarded by `restorability` so it never discards work it didn't create:
  it refuses on a dirty working tree, when there is no retained history to
  restore, and when HEAD has moved past the retained tip with commits that
  would be lost by resetting back to it.

  Background:
    Given a test project
    And the workflow

  Scenario: restores the full pre-squash commit chain after a squash, and clears the retained-history ref — also covers restoring immediately after a fresh squash
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds

    # unwind: simulate the `git revert --no-commit` — @inmem never executes
    # scripts — by reverting the working tree to the start commit ourselves.
    Given the file "NOTE.md" is deleted
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing. No open questions.
      """
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan for the thing. No open questions.
      """
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-thing.md" with:
      """
      Package: add src/thing.ts exporting `thing`.
      """
    When I run gtd land
    Then it succeeds

    Given a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-thing.md
      """
    When I run gtd land
    Then it succeeds

    Given a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(agent): packages.item.spec.review → packages.item.closing"

    Given the file ".gtd/packages/01-thing.md" is deleted
    And the file ".gtd/NEXT.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.item.closing → packages.picking"

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): packages.picking → build.review.reviewing"

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [ ] ./src/thing.ts#1
      new export
      """
    When I run gtd land
    Then it succeeds

    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [x] ./src/thing.ts#1
      new export
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): build.review.await-review → build.review.deciding"

    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.squashing"

    Given a file ".gtd/COMMIT_MSG.md" with:
      """
      feat: add thing

      Adds src/thing.ts.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "feat: add thing"
    And the git ref "refs/worktree/gtd/history" exists

    When I run gtd with args "restore"
    Then it succeeds
    And stdout contains "restored the retained history"
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      chore: init gtd workflow
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      gtd(check): start-gate.check → design.triage
      gtd(agent): design.triage → design.gate.check
      gtd(check): design.gate.check → architecture.author
      gtd(agent): architecture.author → architecture.gate.check
      gtd(check): architecture.gate.check → architecture.decompose
      gtd(agent): architecture.decompose → packages.picking
      gtd(check): packages.picking → packages.item.building
      gtd(agent): packages.item.building → packages.item.health.check
      gtd(check): packages.item.health.check → packages.item.spec.review
      gtd(agent): packages.item.spec.review → packages.item.closing
      gtd(check): packages.item.closing → packages.picking
      gtd(check): packages.picking → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.await-review
      gtd(human): build.review.await-review → build.review.deciding
      gtd(check): build.review.deciding → build.squashing
      """
    And the git ref "refs/worktree/gtd/history" does not exist

  Scenario: refuses when there is no retained history to restore
    When I run gtd with args "restore"
    Then it fails
    And stderr contains "gtd restore: no retained history to restore."

  Scenario: refuses on a dirty working tree, even with retained history available
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(human): idle → unwind"
    # Abandon here, still resting AT unwind, before its own script lands: past
    # that point NOTE.md would already be gone from the tree, with nothing
    # left to leave dirty.
    When I run gtd with args "abandon"
    Then it succeeds
    And the git ref "refs/worktree/gtd/history" exists
    # The abandon left "NOTE.md" as an uncommitted pending change — the
    # tree is dirty, so restore refuses before it even looks at the ref.
    When I run gtd with args "restore"
    Then it fails
    And stderr contains "gtd restore: refuses on a dirty working tree"

  Scenario: cleaned-abandon safety case — restore succeeds when HEAD is an ancestor of the retained tip
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds

    # unwind: simulate the `git revert --no-commit` — @inmem never executes
    # scripts — by reverting the working tree to the start commit ourselves.
    Given the file "NOTE.md" is deleted
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → design.triage"

    When I run gtd with args "abandon"
    Then it succeeds
    And the git ref "refs/worktree/gtd/history" exists
    And the last commit subject is "chore: init gtd workflow"

    # Past the unwind, the abandon leaves nothing pending at all — NOTE.md is
    # already gone from the tree — so restore's dirty-tree guard never fires.
    When I run gtd with args "restore"
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → design.triage"
    And the git ref "refs/worktree/gtd/history" does not exist

  Scenario: work-on-top refusal — a commit made after the squash is never discarded
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds

    # unwind: simulate the `git revert --no-commit` — @inmem never executes
    # scripts — by reverting the working tree to the start commit ourselves.
    Given the file "NOTE.md" is deleted
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Build a thing. No open questions.
      """
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan for the thing. No open questions.
      """
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-thing.md" with:
      """
      Package: add src/thing.ts exporting `thing`.
      """
    When I run gtd land
    Then it succeeds

    Given a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-thing.md
      """
    When I run gtd land
    Then it succeeds

    Given a file "src/thing.ts" with:
      """
      export const thing = 1
      """
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given the file ".gtd/packages/01-thing.md" is deleted
    And the file ".gtd/NEXT.md" is deleted
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [ ] ./src/thing.ts#1
      new export
      """
    When I run gtd land
    Then it succeeds

    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: abc1234
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add thing.ts

      - [x] ./src/thing.ts#1
      new export
      """
    When I run gtd land
    Then it succeeds

    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds

    Given a file ".gtd/COMMIT_MSG.md" with:
      """
      feat: add thing

      Adds src/thing.ts.
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "feat: add thing"

    Given a commit "docs: add note" that adds "NOTE.md" with:
      """
      A note added after the squash landed.
      """

    When I run gtd with args "restore"
    Then it fails
    And stderr contains "HEAD has advanced past the squash"
    And stderr matches "HEAD [0-9a-f]{7} is ahead of the retained tip [0-9a-f]{7}"
    And the last commit subject is "docs: add note"

  Scenario: superseded-ref case — two squashes in a row retain only the second tip, so restore lands on the second process's history
    Given a file "NOTE.md" with:
      """
      Build the first thing.
      """
    When I run gtd land
    Then it succeeds

    # unwind: simulate the `git revert --no-commit` — @inmem never executes
    # scripts — by reverting the working tree to the start commit ourselves.
    Given the file "NOTE.md" is deleted
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the first thing. No open questions.
      """
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan for the first thing. No open questions.
      """
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-one.md" with:
      """
      Package: add src/one.ts.
      """
    When I run gtd land
    Then it succeeds

    Given a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-one.md
      """
    When I run gtd land
    Then it succeeds

    Given a file "src/one.ts" with:
      """
      export const one = 1
      """
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given the file ".gtd/packages/01-one.md" is deleted
    And the file ".gtd/NEXT.md" is deleted
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: cycle-one
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add one.ts

      - [ ] ./src/one.ts#1
      new export
      """
    When I run gtd land
    Then it succeeds

    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: cycle-one
      <!-- base: abc1234def5678901234567890123456789abcd -->

      ## Add one.ts

      - [x] ./src/one.ts#1
      new export
      """
    When I run gtd land
    Then it succeeds

    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds

    Given a file ".gtd/COMMIT_MSG.md" with:
      """
      feat: cycle one
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "feat: cycle one"
    And the git ref "refs/worktree/gtd/history" exists

    # Second process, on top of the first squash — its own retainHistory call
    # rolls the SAME ref forward to its own pre-squash tip.
    Given a file "NOTE.md" with:
      """
      Build the second thing.
      """
    When I run gtd land
    Then it succeeds

    # unwind: simulate the `git revert --no-commit` — @inmem never executes
    # scripts — by reverting the working tree to the start commit ourselves.
    Given the file "NOTE.md" is deleted
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given a file ".gtd/REQUIREMENTS.md" with:
      """
      Build the second thing. No open questions.
      """
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given the file ".gtd/REQUIREMENTS.md" is deleted
    And a file ".gtd/ARCHITECTURE.md" with:
      """
      Technical plan for the second thing. No open questions.
      """
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given the file ".gtd/ARCHITECTURE.md" is deleted
    And a file ".gtd/packages/01-two.md" with:
      """
      Package: add src/two.ts.
      """
    When I run gtd land
    Then it succeeds

    Given a file ".gtd/NEXT.md" with:
      """
      .gtd/packages/01-two.md
      """
    When I run gtd land
    Then it succeeds

    Given a file "src/two.ts" with:
      """
      export const two = 2
      """
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given the file ".gtd/packages/01-two.md" is deleted
    And the file ".gtd/NEXT.md" is deleted
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds

    Given a file ".gtd/REVIEW.md" with:
      """
      # Review: cycle-two
      <!-- base: def5678901234567890123456789012345678abc -->

      ## Add two.ts

      - [ ] ./src/two.ts#1
      new export
      """
    When I run gtd land
    Then it succeeds

    Given ".gtd/REVIEW.md" is modified to:
      """
      # Review: cycle-two
      <!-- base: def5678901234567890123456789012345678abc -->

      ## Add two.ts

      - [x] ./src/two.ts#1
      new export
      """
    When I run gtd land
    Then it succeeds

    Given the file ".gtd/REVIEW.md" is deleted
    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): build.review.deciding → build.squashing"

    Given a file ".gtd/COMMIT_MSG.md" with:
      """
      feat: cycle two
      """
    When I run gtd land
    Then it succeeds
    And the last commit subject is "feat: cycle two"
    And the git ref "refs/worktree/gtd/history" exists

    When I run gtd with args "restore"
    Then it succeeds
    And the git ref "refs/worktree/gtd/history" does not exist
    And the commit subjects from oldest to newest are:
      """
      chore: initial commit
      chore: init gtd workflow
      feat: cycle one
      gtd(human): idle → unwind
      gtd(check): unwind → start-gate.check
      gtd(check): start-gate.check → design.triage
      gtd(agent): design.triage → design.gate.check
      gtd(check): design.gate.check → architecture.author
      gtd(agent): architecture.author → architecture.gate.check
      gtd(check): architecture.gate.check → architecture.decompose
      gtd(agent): architecture.decompose → packages.picking
      gtd(check): packages.picking → packages.item.building
      gtd(agent): packages.item.building → packages.item.health.check
      gtd(check): packages.item.health.check → packages.item.spec.review
      gtd(agent): packages.item.spec.review → packages.item.closing
      gtd(check): packages.item.closing → packages.picking
      gtd(check): packages.picking → build.review.reviewing
      gtd(agent): build.review.reviewing → build.review.await-review
      gtd(human): build.review.await-review → build.review.deciding
      gtd(check): build.review.deciding → build.squashing
      """

  Scenario: --json reports the restored state, hash, and prior state on success
    Given a file "NOTE.md" with:
      """
      Build a thing.
      """
    When I run gtd land
    Then it succeeds

    # unwind: simulate the `git revert --no-commit` — @inmem never executes
    # scripts — by reverting the working tree to the start commit ourselves.
    Given the file "NOTE.md" is deleted
    When I run gtd land
    Then it succeeds

    When I run gtd land
    Then it succeeds
    And the last commit subject is "gtd(check): start-gate.check → design.triage"

    # Past the unwind, abandon leaves nothing pending at all, so restore's
    # dirty-tree guard never fires.
    When I run gtd with args "abandon"
    Then it succeeds

    When I run gtd with args "restore --json"
    Then it succeeds
    And stdout contains "\"restored\":true"
    And stdout contains "\"state\":\"design.triage\""
    And stdout contains "\"from\":\"idle\""

  Scenario: --json reports the standard error envelope on refusal
    When I run gtd with args "restore --json"
    Then it fails
    And stdout contains "\"state\":\"error\""
    And stdout contains "no retained history to restore"

  Scenario: takes no positional argument
    When I run gtd with args "restore foo"
    Then it fails
    And stderr contains "gtd restore: too many arguments"
