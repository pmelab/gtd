@inmem
Feature: Review lifecycle — Clean → Await → Accept/Done → Idle

  With no steering files and a clean tree, unreviewed work since the review base
  enters Clean (author REVIEW.md). Committing REVIEW.md awaits the user; a later
  run with no edits approves (`gtd: done` → Idle), while substantive edits to
  the code or REVIEW.md are feedback: they seed a fresh plan (Accept Review →
  Grilling) within the same open process — no `gtd: done` is committed on the
  feedback path.

  The review base (what a review covers) is determined by four rules:
  1. Within a gtd process (a `gtd: grilling` commit exists after the last
     `gtd: done`), first review → base = first `gtd: grilling` of the current
     cycle; refDiff spans the whole task.
  2. Within a process, follow-up (a `gtd: awaiting review` also exists in the
     current cycle) → base = last `gtd: awaiting review`; refDiff spans only
     the work packages built after that review.
  3. Outside a process, on a feature branch → base = merge-base with the
     default branch; refDiff always spans the whole branch, even when a prior
     process completed on it (approved work is re-covered by design).
  4. Outside a process, on the default branch → skip review (Idle;
     `reviewBase`/`refDiff` unset).

  Whether a review fires is gated separately: the outside-process review only
  fires when commits exist after the last `gtd: done` (or none exists), so an
  approved review settles Idle instead of looping review → approve → done →
  review. Workflow files (REVIEW.md, TODO.md, FEEDBACK.md, ERRORS.md, `.gtd/`)
  are excluded from every review diff — the reviewer never writes chunks about
  plumbing churn; a diff that is empty after filtering settles Idle too.

  Scenario: Freshly committed branch work with a clean tree enters Clean to author REVIEW.md
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    When I run gtd
    Then it succeeds
    And stdout contains "help a human to review the changes"
    And stdout contains "Changes to review"
    And stdout contains "src/calc.ts"

  Scenario: An uncommitted REVIEW.md is committed and auto-advances to Done in one run
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
    And the last commit subject is "gtd: done"
    And the git log contains "gtd: awaiting review"
    And the file "REVIEW.md" does not exist
    And stdout does not contain "## Task: Await the user's review"

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

  Scenario: A textual annotation in REVIEW.md (non-checkbox edit) is feedback, not approval
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
    # The changeset is durably captured before being reverted.
    And the git log contains "gtd: review feedback"
    And the file "REVIEW.md" does not exist
    And the file "TODO.md" exists
    # The process stays open: no `gtd: done` is committed on the feedback path.
    And the git log does not contain "gtd: done"
    And stdout contains "holds the plan under development"

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
    And the git log contains "gtd: review feedback"
    And the file "REVIEW.md" does not exist
    And the file "TODO.md" exists
    # The reviewer's annotation is captured into the plan but discarded from code.
    And the file "TODO.md" contains "please also add subtract"
    And the file "src/calc.ts" does not contain "please also add subtract"
    # The process stays open: no `gtd: done` is committed on the feedback path.
    And the git log does not contain "gtd: done"
    And stdout contains "holds the plan under development"

  # The leak regression: a plain checkout discards only tracked edits, so a
  # reviewer-added NEW file used to be committed verbatim by the next grilling
  # round while also being re-planned in TODO.md. Commit-then-revert drops it
  # from the tree and captures it as a suggestion instead.
  Scenario: A new file added by the reviewer is captured as a suggestion, not committed verbatim
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      - ./src/calc.ts#1
      """
    And a file "src/subtract.ts" with:
      """
      export const subtract = (a: number, b: number) => a - b
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And the git log contains "gtd: review feedback"
    # Dropped from the tree, planned for re-implementation instead.
    And the file "src/subtract.ts" does not exist
    And the file "TODO.md" contains "export const subtract"
    And the git log does not contain "gtd: done"

  # The capture commit contains the annotated REVIEW.md. If a checkout/pull
  # loses the uncommitted seed, the machine sees committed REVIEW + clean tree —
  # which must regenerate the seed, NOT route to Done and silently approve the
  # annotations.
  Scenario: A lost accept-review seed regenerates instead of approving the annotations
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And "REVIEW.md" is modified to:
      """
      # Review

      - [ ] ./src/calc.ts#1

      Please also add a subtract function.
      """
    And the working tree is committed as "gtd: review feedback"
    When I run gtd
    Then it succeeds
    And the git log does not contain "gtd: done"
    And the last commit subject is "gtd: grilling"
    And the file "REVIEW.md" does not exist
    And the file "TODO.md" exists
    And the file "TODO.md" contains "Please also add a subtract function."
    And stdout contains "holds the plan under development"

  # Checkbox ticks are approval signals, but ONLY when nothing else changed:
  # mixed with a code edit they ride along as feedback into the capture.
  Scenario: Checkbox ticks mixed with a code edit are feedback, not approval
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And "REVIEW.md" is modified to:
      """
      # Review

      - [x] ./src/calc.ts#1
      """
    And "src/calc.ts" is modified to:
      """
      export const add = (a: number, b: number) => a + b
      export const sub = (a: number, b: number) => a - b
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And the git log contains "gtd: review feedback"
    And the git log does not contain "gtd: done"
    And the file "TODO.md" contains "export const sub"
    And the file "src/calc.ts" does not contain "export const sub"

  Scenario: Emptying REVIEW.md's content is a textual change, not an approval
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      - [ ] ./src/calc.ts#1
      """
    And an empty file "REVIEW.md"
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And the git log does not contain "gtd: done"
    And the file "TODO.md" exists

  # An uncommitted TODO.md under a committed REVIEW.md is global feedback, not
  # an illegal combination — the reviewer reached for plan-level notes.
  Scenario: Plan notes written into TODO.md during a review are feedback, not an error
    Given a test project
    And a commit "feat: add calculator" that adds "src/calc.ts" with:
      """
      export const add = (a: number, b: number) => a + b
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      - ./src/calc.ts#1
      """
    And a file "TODO.md" with:
      """
      Next iteration should cover division too.
      """
    When I run gtd
    Then it succeeds
    And the last commit subject is "gtd: grilling"
    And the file "REVIEW.md" does not exist
    And the file "TODO.md" contains "division"
    And the git log does not contain "gtd: done"

  Scenario: A closed review with nothing left to review is Idle
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "gtd: done"
    When I run gtd
    Then it succeeds
    And stdout contains "repository is idle — nothing to do"
    And stdout does not contain "help a human to review the changes"

  # Regression anchor: the review used to loop — after approval, the merge-base
  # diff was still non-empty, so the next run re-entered Clean and wrote the
  # same REVIEW.md again (review → approve → done → review → …). The
  # commits-after-last-done gate keeps gtd Idle until new commits land.
  Scenario: Approving a review settles Idle and never loops back into a fresh review
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
    # Approves the review (gtd: done). The branch diff against the merge-base is
    # still non-empty, but no commits exist after `gtd: done` — Idle, not Clean.
    And the last commit subject is "gtd: done"
    And the file "REVIEW.md" does not exist
    And stdout contains "repository is idle — nothing to do"
    And stdout does not contain "help a human to review the changes"
    And I record the commit count
    When I run gtd
    Then it succeeds
    And stdout contains "repository is idle — nothing to do"
    And stdout does not contain "help a human to review the changes"
    And the file "REVIEW.md" does not exist
    And the commit count is unchanged

  Scenario: A new commit after gtd: done re-opens the review for the whole branch
    Given a test project
    And a default branch "main"
    And a branch "feature"
    And a commit "feat: first slice" that adds "src/first.ts" with:
      """
      export const first = 1
      """
    And a commit "gtd: done"
    And a commit "feat: second slice" that adds "src/second.ts" with:
      """
      export const second = 2
      """
    When I run gtd
    Then it succeeds
    And stdout contains "help a human to review the changes"
    # Whole-branch scope: the already-approved first slice is re-covered.
    And stdout contains "src/first.ts"
    And stdout contains "src/second.ts"

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
    And stdout contains "help a human to review the changes"
    And stdout contains "src/parser.ts"

  # Rule 1: within-process first review — base = first gtd: grilling of the
  # current task cycle; only work committed after grilling appears in the
  # review, and the TODO.md plumbing churn is filtered out of the diff.
  Scenario: Within-process first review covers work since gtd: grilling (Rule 1)
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan
      - [ ] add greeter
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "feat: add greeter" that adds "src/greet.ts" with:
      """
      export const greet = (name: string) => `Hello, ${name}`
      """
    When I run gtd
    Then it succeeds
    And stdout contains "help a human to review the changes"
    And stdout contains "src/greet.ts"
    And stdout does not contain "a/TODO.md"

  # Rule 2: within-process follow-up review — after review feedback re-entered
  # grilling → planning → building, the next review covers only the new work
  # packages (base = last `gtd: awaiting review`), and the workflow-file churn
  # (REVIEW.md removal, TODO.md seed/delete) never shows up as review chunks.
  Scenario: After a feedback cycle the follow-up review covers only the new work (Rule 2)
    Given a test project
    And a commit "gtd: grilling" that adds "TODO.md" with:
      """
      # Plan
      - [ ] add greeter
      """
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "feat: add greeter" that adds "src/greet.ts" with:
      """
      export const greet = (name: string) => `Hello, ${name}`
      """
    And a commit "gtd: awaiting review" that adds "REVIEW.md" with:
      """
      # Review

      ## Add greeter

      - [ ] ./src/greet.ts#1
      """
    # The user left feedback; Accept Review captured it durably as
    # `gtd: review feedback`, then Grilling committed the seeded plan together
    # with REVIEW.md's removal (the feedback path).
    And "REVIEW.md" is modified to:
      """
      # Review

      ## Add greeter

      - [ ] ./src/greet.ts#1

      Please also add a farewell function.
      """
    And the working tree is committed as "gtd: review feedback"
    And a deleted committed file "REVIEW.md"
    And a file "TODO.md" with:
      """
      # Plan
      - [ ] add farewell
      """
    And the working tree is committed as "gtd: grilling"
    And a commit "gtd: planning" that deletes "TODO.md"
    And a commit "feat: add farewell" that adds "src/farewell.ts" with:
      """
      export const farewell = (name: string) => `Goodbye, ${name}`
      """
    When I run gtd
    Then it succeeds
    And stdout contains "help a human to review the changes"
    And stdout contains "src/farewell.ts"
    And stdout does not contain "src/greet.ts"
    # Workflow-file churn is filtered out of the review diff.
    And stdout does not contain "a/REVIEW.md"
    And stdout does not contain "a/TODO.md"
    # The process stayed open throughout: no `gtd: done` was ever committed.
    And the git log does not contain "gtd: done"

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
    And stdout contains "help a human to review the changes"
    And stdout contains "src/parser.ts"

  # Rule 4: outside a process, default branch — the branch review never fires.
  Scenario: Outside-process default branch skips review and settles Idle (Rule 4)
    Given a test project
    And a commit "feat: trunk work" that adds "src/trunk.ts" with:
      """
      export const trunk = () => "trunk"
      """
    When I run gtd
    Then it succeeds
    And stdout contains "repository is idle — nothing to do"
    And stdout does not contain "help a human to review the changes"

  # On the default branch only the review trigger is suppressed — a dirty tree
  # still seeds New Feature exactly as on any branch.
  Scenario: On the default branch a dirty tree still seeds a new feature
    Given a test project
    And a commit "gtd: done"
    And a file "src/extra.ts" with:
      """
      export const extra = () => "extra"
      """
    When I run gtd
    Then it succeeds
    And the git log contains "gtd: new task"
    And the last commit subject is "gtd: grilling"
    And the file "src/extra.ts" does not exist
    And the file "TODO.md" exists
    And the file "TODO.md" contains "src/extra.ts"
    And stdout contains "holds the plan under development"
