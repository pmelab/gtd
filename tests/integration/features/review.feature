Feature: Review lifecycle — Clean → Await → Accept/Done → Idle

  With no steering files and a clean tree, unreviewed work since the review base
  enters Clean (author REVIEW.md). Committing REVIEW.md awaits the user; a later
  run with no edits approves (`gtd: done` → Idle), while edits to the code or
  REVIEW.md seed a fresh plan (Accept Review → Grilling).

  The review base is determined by four rules:
  1. Within a gtd process (a `gtd: grilling` commit exists after the last
     `gtd: done`), first review → base = first `gtd: grilling` of the current
     cycle; refDiff spans the whole task.
  2. Within a process, incremental (a `gtd: awaiting review` also exists in the
     current cycle) → base = last `gtd: awaiting review`; refDiff spans only
     post-review changes.
  3. Outside a process, on a feature branch → base = merge-base with the default
     branch; refDiff spans the whole branch.
  4. Outside a process, on the default branch → skip review (Idle;
     `reviewBase`/`refDiff` unset).

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

  Scenario: A committed REVIEW.md with base marker and unchecked boxes still finishes as gtd: done
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review: abc1234

      <!-- base: abc1234deadbeefabc1234deadbeefabc1234de -->

      ## Add calculator

      - [ ] ./src/calc.ts#1 — new add function
      - [ ] ./src/calc.ts#1 — export statement
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: done"
    And the file "REVIEW.md" does not exist

  Scenario: Checking off REVIEW.md checkboxes approves the review
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      ## Add calculator

      - [ ] ./src/calc.ts#1 — new add function
      - [ ] ./src/calc.ts#1 — export statement
      """
    And "REVIEW.md" is modified to:
      """
      # Review

      ## Add calculator

      - [x] ./src/calc.ts#1 — new add function
      - [x] ./src/calc.ts#1 — export statement
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: done"
    And the file "REVIEW.md" does not exist
    And the file "TODO.md" does not exist
    And stdout does not contain "Grilling"

  Scenario: A textual annotation in REVIEW.md (non-checkbox edit) requests changes
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      ## Add calculator

      - [ ] ./src/calc.ts#1 — new add function
      """
    And "REVIEW.md" is modified to:
      """
      # Review

      ## Add calculator

      - [ ] ./src/calc.ts#1 — new add function

      Please also add a subtract function.
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And the file "REVIEW.md" does not exist
    And the file "TODO.md" exists
    And stdout contains "## Task: Grill the plan in `TODO.md`"

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

  Scenario: A completed branch review settles in Idle, not a fresh review
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "feat: branch work" that adds "src/feat.ts" with:
      """
      export const feat = () => "feat"
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      - ./src/feat.ts#1
      """
    When I run gtd
    Then it succeeds
    # Approves the review (gtd: done). HEAD gtd: done is an Idle boundary — the
    # machine settles Idle without re-reviewing the branch.
    And the last commit subject is "gtd: done"
    And the file "REVIEW.md" does not exist
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

  # Rule 1: within-process first review — base = first gtd: grilling of the
  # current task cycle; only work committed after grilling appears in the review.
  Scenario: Within-process first review covers work since gtd: grilling (Rule 1)
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan
      - [ ] add greeter
      """
    And a commit "feat: add greeter" that adds "src/greet.ts" with:
      """
      export const greet = (name: string) => `Hello, ${name}`
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Create `REVIEW.md` for the finished work"
    And stdout contains "src/greet.ts"

  # Rule 2: within-process incremental review — a `gtd: awaiting review` exists
  # in the current cycle (no REVIEW.md at HEAD; review already processed); only
  # work committed after that marker appears in the next review.
  Scenario: Within-process incremental review covers only post-review changes (Rule 2)
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan
      - [ ] add greeter
      - [ ] add farewell
      """
    And a commit "feat: add greeter" that adds "src/greet.ts" with:
      """
      export const greet = (name: string) => `Hello, ${name}`
      """
    And a commit "gtd: awaiting review"
    And a commit "feat: add farewell" that adds "src/farewell.ts" with:
      """
      export const farewell = (name: string) => `Goodbye, ${name}`
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Create `REVIEW.md` for the finished work"
    And stdout contains "src/farewell.ts"
    And stdout does not contain "src/greet.ts"

  # Rule 3: outside a process, feature branch — base = merge-base; whole branch reviewed.
  Scenario: Outside-process feature branch reviews from the merge-base (Rule 3)
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

  # Rule 4: outside a process, default branch — skip review (Idle).
  Scenario: Outside-process default branch skips review and settles Idle (Rule 4)
    Given a test project
    And a commit "feat: trunk work" that adds "src/trunk.ts" with:
      """
      export const trunk = () => "trunk"
      """
    When I run gtd
    Then it succeeds
    And stdout contains "## Task: Nothing to do"
    And stdout does not contain "## Task: Create `REVIEW.md`"
