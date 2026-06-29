Feature: Review lifecycle — Clean → Await → Accept/Done → Idle

  With no steering files and a clean tree, unreviewed work since the review base
  enters Clean (author REVIEW.md). Committing REVIEW.md awaits the user; a later
  run with no edits approves (`gtd: done` → Idle), while edits to the code or
  REVIEW.md seed a fresh plan (Accept Review → Grilling). The review base is the
  merge-base on a feature branch, or the last REVIEW.md deletion on the default
  branch.

  Scenario: Freshly committed work with a clean tree enters Clean to author REVIEW.md
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Create `REVIEW.md` for the finished work"
    And stdout contains "Changes to review"
    And stdout contains "src/calc.ts"

  Scenario: An uncommitted REVIEW.md is committed and awaits the user
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a file "REVIEW.md" with:
      """
      # Review

      ## Add calculator

      - ./src/calc.ts#1
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: awaiting review"
    And stdout contains "## Task: Await the user's review"

  Scenario: A committed REVIEW.md approved with no edits finishes as gtd: done
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      ## Add calculator

      - ./src/calc.ts#1
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: done"
    And the file "REVIEW.md" does not exist

  Scenario: Editing the code under a committed REVIEW.md seeds a fresh plan
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      ## Add calculator

      - ./src/calc.ts#1
      """
    And "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      // reviewer: please also add subtract
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And the file "REVIEW.md" does not exist
    And the file "TODO.md" exists
    # The reviewer's annotation is captured into the plan but discarded from code.
    And the file "TODO.md" contains "please also add subtract"
    And the file "src/calc.ts" does not contain "please also add subtract"
    And stdout contains "## Task: Grill the plan in `TODO.md`"

  Scenario: A closed review with nothing left to review is Idle
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "gtd: done"
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Nothing to do"
    And stdout does not contain "## Task: Create `REVIEW.md`"

  Scenario: A coworker's non-gtd commit on a feature branch reviews against the merge-base
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "feat: coworker parser" that adds "src/parser.ts" with:
      """
      export const parse = (s: string) => JSON.parse(s)
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Create `REVIEW.md` for the finished work"
    And stdout contains "src/parser.ts"

  Scenario: On the default branch the review base is the last REVIEW.md deletion
    Given a test project
    And a commit "feat: old work" that adds "src/old.ts" with:
      """
      export const old = () => "old"
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      - ./src/old.ts#1
      """
    And a commit "gtd: done" that deletes "REVIEW.md"
    And a commit "feat: newer work" that adds "src/newer.ts" with:
      """
      export const newer = () => "new"
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Create `REVIEW.md` for the finished work"
    And stdout contains "src/newer.ts"
    And stdout does not contain "src/old.ts"
