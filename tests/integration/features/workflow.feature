Feature: GTD workflow cycle

  Scenario: Seed and plan
    Given a test project
    And a staged file "TODO.md" with:
      """
      - add a `multiply` function to `src/math.ts` that multiplies two numbers
      - add a test for the `multiply` function in `tests/math.test.ts`
      """
    When I run gtd
    Then it succeeds
    And git log contains "🌱"
    And last commit prefix is "🤖"
    And "TODO.md" contains "- [ ]"

  Scenario: Seed from untracked TODO
    Given a test project
    And an untracked file "TODO.md" with:
      """
      - add a `multiply` function to `src/math.ts` that multiplies two numbers
      - add a test for the `multiply` function in `tests/math.test.ts`
      """
    When I run gtd
    Then it succeeds
    And git log contains "🌱"

  Scenario: Feedback and re-plan
    Given a test project
    And a commit "🌱 seed: initial task list" that adds "TODO.md" with:
      """
      - add a `multiply` function to `src/math.ts` that multiplies two numbers
      - add a test for the `multiply` function in `tests/math.test.ts`
      """
    And a commit "🤖 plan: structured action items" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [ ] add a test for the `multiply` function in `tests/math.test.ts`
      """
    And "TODO.md" has appended blockquote "> please also add error handling for non-numeric inputs"
    And "src/math.ts" has an appended newline
    When I run gtd
    Then it succeeds
    And "TODO.md" does not contain "> please also add"
    And git log contains "🤦"
    And git log contains "👷"
    And last commit prefix is "🤖"

  Scenario: Build action items
    Given a test project
    And a commit "🌱 seed: initial task list" that adds "TODO.md" with:
      """
      - add a `multiply` function to `src/math.ts` that multiplies two numbers
      - add a test for the `multiply` function in `tests/math.test.ts`
      """
    And a commit "🤖 plan: structured action items" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [ ] add a test for the `multiply` function in `tests/math.test.ts`
      """
    And a commit "💬 feedback: add error handling requirement" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [ ] add a test for the `multiply` function in `tests/math.test.ts`

      > please also add error handling for non-numeric inputs
      """
    And a commit "👷 fix: formatting" that updates "src/math.ts" with:
      """
      export const add = (a: number, b: number): number => a + b


      """
    And a commit "🤖 plan: updated action items" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [ ] add a test for the `multiply` function in `tests/math.test.ts`
      - [ ] add input validation for non-numeric arguments in `src/math.ts`
      """
    When I run gtd
    Then it succeeds
    And "src/math.ts" contains "multiply"
    And npm test passes
    And "TODO.md" contains "- [x]"
    And last commit prefix is "🔨"

  Scenario: Code TODOs committed
    Given a test project
    And a commit "🌱 seed: initial task list" that adds "TODO.md" with:
      """
      - add a `multiply` function to `src/math.ts` that multiplies two numbers
      - add a test for the `multiply` function in `tests/math.test.ts`
      """
    And a commit "🤖 plan: structured action items" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [ ] add a test for the `multiply` function in `tests/math.test.ts`
      """
    And a commit "💬 feedback: add error handling requirement" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [ ] add a test for the `multiply` function in `tests/math.test.ts`

      > please also add error handling for non-numeric inputs
      """
    And a commit "👷 fix: formatting" that updates "src/math.ts" with:
      """
      export const add = (a: number, b: number): number => a + b


      """
    And a commit "🤖 plan: updated action items" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [ ] add a test for the `multiply` function in `tests/math.test.ts`
      - [ ] add input validation for non-numeric arguments in `src/math.ts`
      """
    And a staged file "src/math.ts" with:
      """
      export const add = (a: number, b: number): number => a + b

      export const multiply = (a: number, b: number): number => a * b
      """
    And a staged file "tests/math.test.ts" with:
      """
      import { expect, test } from "vitest"
      import { add, multiply } from "../src/math.js"

      test("add returns sum of two numbers", () => {
        expect(add(2, 3)).toBe(5)
      })

      test("multiply returns product of two numbers", () => {
        expect(multiply(3, 4)).toBe(12)
      })
      """
    And a staged file "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [x] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [x] add a test for the `multiply` function in `tests/math.test.ts`
      - [x] add input validation for non-numeric arguments in `src/math.ts`
      """
    And a commit "🔨 build: implement multiply function"
    And "src/math.ts" has prepended "// TODO: never use magic numbers, always use named constants"
    And "TODO.md" has appended blockquote "> please add a subtract function too"
    And "src/math.ts" has appended "// fixed"
    When I run gtd
    Then it succeeds
    And "src/math.ts" does not contain "// TODO: never use magic numbers"
    And git log contains "💬"
    And last commit prefix is "🤖"

  Scenario: Second build after feedback
    Given a test project
    And a commit "🌱 seed: initial task list" that adds "TODO.md" with:
      """
      - add a `multiply` function to `src/math.ts` that multiplies two numbers
      - add a test for the `multiply` function in `tests/math.test.ts`
      """
    And a commit "🤖 plan: structured action items" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [ ] add a test for the `multiply` function in `tests/math.test.ts`
      """
    And a commit "💬 feedback: add error handling requirement" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [ ] add a test for the `multiply` function in `tests/math.test.ts`

      > please also add error handling for non-numeric inputs
      """
    And a commit "👷 fix: formatting" that updates "src/math.ts" with:
      """
      export const add = (a: number, b: number): number => a + b


      """
    And a commit "🤖 plan: updated action items" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [ ] add a test for the `multiply` function in `tests/math.test.ts`
      - [ ] add input validation for non-numeric arguments in `src/math.ts`
      """
    And a staged file "src/math.ts" with:
      """
      export const add = (a: number, b: number): number => a + b

      export const multiply = (a: number, b: number): number => a * b
      """
    And a staged file "tests/math.test.ts" with:
      """
      import { expect, test } from "vitest"
      import { add, multiply } from "../src/math.js"

      test("add returns sum of two numbers", () => {
        expect(add(2, 3)).toBe(5)
      })

      test("multiply returns product of two numbers", () => {
        expect(multiply(3, 4)).toBe(12)
      })
      """
    And a staged file "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [x] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [x] add a test for the `multiply` function in `tests/math.test.ts`
      - [x] add input validation for non-numeric arguments in `src/math.ts`
      """
    And a commit "🔨 build: implement multiply function"
    And a commit "🤦 human: extract code TODOs" that updates "src/math.ts" with:
      """
      export const add = (a: number, b: number): number => a + b

      export const multiply = (a: number, b: number): number => {
        return a * b
      }
      """
    And a commit "💬 feedback: add subtract function" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [x] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [x] add a test for the `multiply` function in `tests/math.test.ts`
      - [x] add input validation for non-numeric arguments in `src/math.ts`

      > please add a subtract function too
      """
    And a commit "🤖 plan: add subtract action items" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [x] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [x] add a test for the `multiply` function in `tests/math.test.ts`
      - [x] add input validation for non-numeric arguments in `src/math.ts`

      ### Subtract

      - [ ] add a `subtract` function to `src/math.ts` that subtracts two numbers
      - [ ] add a test for the `subtract` function in `tests/math.test.ts`
      """
    When I run gtd
    Then it succeeds
    And npm test passes
    And last commit prefix is "🔨"

  Scenario: Idle when done
    Given a test project
    And a commit "🌱 seed: initial task list" that adds "TODO.md" with:
      """
      - add a `multiply` function to `src/math.ts` that multiplies two numbers
      - add a test for the `multiply` function in `tests/math.test.ts`
      """
    And a commit "🤖 plan: structured action items" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [ ] add a test for the `multiply` function in `tests/math.test.ts`
      """
    And a commit "💬 feedback: add error handling requirement" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [ ] add a test for the `multiply` function in `tests/math.test.ts`

      > please also add error handling for non-numeric inputs
      """
    And a commit "👷 fix: formatting" that updates "src/math.ts" with:
      """
      export const add = (a: number, b: number): number => a + b


      """
    And a commit "🤖 plan: updated action items" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [ ] add a test for the `multiply` function in `tests/math.test.ts`
      - [ ] add input validation for non-numeric arguments in `src/math.ts`
      """
    And a staged file "src/math.ts" with:
      """
      export const add = (a: number, b: number): number => a + b

      export const multiply = (a: number, b: number): number => a * b
      """
    And a staged file "tests/math.test.ts" with:
      """
      import { expect, test } from "vitest"
      import { add, multiply } from "../src/math.js"

      test("add returns sum of two numbers", () => {
        expect(add(2, 3)).toBe(5)
      })

      test("multiply returns product of two numbers", () => {
        expect(multiply(3, 4)).toBe(12)
      })
      """
    And a staged file "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [x] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [x] add a test for the `multiply` function in `tests/math.test.ts`
      - [x] add input validation for non-numeric arguments in `src/math.ts`
      """
    And a commit "🔨 build: implement multiply function"
    And a commit "🤦 human: extract code TODOs" that updates "src/math.ts" with:
      """
      export const add = (a: number, b: number): number => a + b

      export const multiply = (a: number, b: number): number => {
        return a * b
      }
      """
    And a commit "💬 feedback: add subtract function" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [x] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [x] add a test for the `multiply` function in `tests/math.test.ts`
      - [x] add input validation for non-numeric arguments in `src/math.ts`

      > please add a subtract function too
      """
    And a commit "🤖 plan: add subtract action items" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [x] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [x] add a test for the `multiply` function in `tests/math.test.ts`
      - [x] add input validation for non-numeric arguments in `src/math.ts`

      ### Subtract

      - [ ] add a `subtract` function to `src/math.ts` that subtracts two numbers
      - [ ] add a test for the `subtract` function in `tests/math.test.ts`
      """
    And a staged file "src/math.ts" with:
      """
      export const add = (a: number, b: number): number => a + b

      export const multiply = (a: number, b: number): number => a * b

      export const subtract = (a: number, b: number): number => a - b
      """
    And a staged file "tests/math.test.ts" with:
      """
      import { expect, test } from "vitest"
      import { add, multiply, subtract } from "../src/math.js"

      test("add returns sum of two numbers", () => {
        expect(add(2, 3)).toBe(5)
      })

      test("multiply returns product of two numbers", () => {
        expect(multiply(3, 4)).toBe(12)
      })

      test("subtract returns difference of two numbers", () => {
        expect(subtract(5, 3)).toBe(2)
      })
      """
    And a staged file "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [x] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [x] add a test for the `multiply` function in `tests/math.test.ts`
      - [x] add input validation for non-numeric arguments in `src/math.ts`

      ### Subtract

      - [x] add a `subtract` function to `src/math.ts` that subtracts two numbers
      - [x] add a test for the `subtract` function in `tests/math.test.ts`

      ## Learnings

      - avoid magic numbers in business logic
      - always validate inputs at system boundaries
      """
    And a commit "🔨 build: implement subtract function"
    And a commit "🎓 learn: persist learnings to AGENTS.md" that adds "AGENTS.md" with:
      """
      ## Learnings

      - always validate inputs at system boundaries
      """
    And a commit "🧹 cleanup: remove TODO.md" that removes "TODO.md"
    When I run gtd
    Then it succeeds
    And output contains "Nothing to do"

  Scenario: Formatting is normalized before commit
    Given a test project
    And a staged file "TODO.md" with:
      """
      - add a `multiply` function to `src/math.ts`   that multiplies    two numbers
      - add a test for the `multiply` function in `tests/math.test.ts`
      """
    When I run gtd
    Then it succeeds
    And "TODO.md" does not contain "  that multiplies"
    And git log contains "🌱"

  Scenario: New-file commit via step
    Given a test project
    And a commit "add README" that adds "README.md" with:
      """
      # My Project
      """
    Then git log contains "add README"
    And "README.md" contains "# My Project"

  Scenario: File-update commit via step
    Given a test project
    And a commit "update math" that updates "src/math.ts" with:
      """
      export const subtract = (a: number, b: number) => a - b
      """
    Then git log contains "update math"
    And "src/math.ts" contains "subtract"

  Scenario: File-removal commit via step
    Given a test project
    And a commit "remove gitignore" that removes ".gitignore"
    Then git log contains "remove gitignore"
    And ".gitignore" does not exist

  Scenario: Staged file then bare commit
    Given a test project
    And a staged file "TODO.md" with:
      """
      - do something
      """
    And a commit "add todo"
    Then git log contains "add todo"
    And "TODO.md" contains "do something"

  Scenario: Untracked file visible to gtd seed
    Given a test project
    And an untracked file "TODO.md" with:
      """
      - add a multiply function
      """
    When I run gtd
    Then it succeeds
    And git log contains "🌱"

  Scenario: Multi-file commit via staged-file steps
    Given a test project
    And a staged file "TODO.md" with:
      """
      - task one
      """
    And a staged file "README.md" with:
      """
      # Project
      """
    And a commit "add docs"
    Then git log contains "add docs"
    And "TODO.md" contains "task one"
    And "README.md" contains "# Project"

  Scenario: --single stops build after one package
    Given a test project
    And a commit "🌱 seed: initial task list" that adds "TODO.md" with:
      """
      - add a multiply function to src/math.ts
      """
    And a commit "🤖 plan: two packages" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts`

      ### Divide

      - [ ] add a `divide` function to `src/math.ts`
      """
    When I run gtd with "--single"
    Then it succeeds
    And last commit prefix is "🔨"
    And "TODO.md" contains "- [ ]"

  Scenario: --single stops after commit-feedback without chaining to next step
    Given a test project
    And a commit "🌱 seed: initial task list" that adds "TODO.md" with:
      """
      - add a multiply function to src/math.ts
      """
    And a commit "🤖 plan: structured action items" that updates "TODO.md" with:
      """
      # Math library

      ## Action Items

      ### Multiply

      - [ ] add a `multiply` function to `src/math.ts` that multiplies two numbers
      - [ ] add a test for the `multiply` function in `tests/math.test.ts`
      """
    And "TODO.md" has appended blockquote "> please also add error handling for non-numeric inputs"
    And "src/math.ts" has an appended newline
    When I run gtd with "--single"
    Then it succeeds
    And git log contains "🤦"
    And last commit prefix is "🤦"
