// `architecture.decompose`: the mechanical write-out from a converged
// `.gtd/ARCHITECTURE.md` into test-driven package files (package 0 for the
// e2e scenarios, then one per settled concern, each declaring its tests
// under `## Tests`); `.gtd/ARCHITECTURE.md` itself must survive. No
// function field — this is data both a `node` process and a promptfoo
// assert import, and a predicate here would put grading logic in the
// fixture.
//
// Two-sided on the one authority this state does NOT have: merging or
// splitting concerns. `architecture.author` already decided that upstream —
// `## Merged Concerns` there is the record of a merge, never a concern of
// its own. `violation`'s fixture bundles two requirements under one heading
// (the settled result of such a merge); the turn must carry that grouping
// over as ONE package file, never re-split it into two. `clean`'s three
// concerns are already disjoint, one requirement each, so a lazy "one file
// per `##` heading" turn happens to pass both — the fixture text and the
// `challenge` in `evals/promptfooconfig.yaml` are what make the bundled
// concern visibly tempting to re-split.
// Both variants' architecture declares the same tests; e2e ones belong to
// package 00, unit ones to any package's `## Tests`.
const DECLARED_TESTS = {
  scenarioPackage: ".gtd/packages/00-e2e-scenarios.md",
  e2e: ["tests/features/signup.feature"],
  unit: [
    "src/pricing/discount.test.ts",
    "src/profile/newsletter.test.ts",
    "src/email/validate.test.ts",
  ],
}

export default Object.freeze({
  name: "architecture-decompose",
  state: "architecture.decompose.decomposing",
  base: {
    "src/pricing/discount.ts": `export const discountedPrice = (price: number): number => price
`,
    "src/profile/newsletter.ts": `export const newsletterOptIn = (userId: string): boolean => false
`,
    "src/email/validate.ts": `export const isValidEmail = (email: string): boolean => email.includes("@")
`,
  },
  variants: {
    clean: {
      ".gtd/ARCHITECTURE.md": `## Interfaces

\`\`\`ts
export const discountedPrice = (price: number): number
export const newsletterOptIn = (userId: string): boolean
export const isValidEmail = (email: string): boolean
\`\`\`

## E2E Scenarios

- e2e: tests/features/signup.feature

\`\`\`gherkin
Feature: Signup
  Scenario: A malformed email is rejected
    When I sign up with "not-an-email"
    Then the signup is rejected
\`\`\`

## Unit Tests

### discountedPrice

- unit: src/pricing/discount.test.ts — applies the discount (covers Discount price badge)

### newsletterOptIn

- unit: src/profile/newsletter.test.ts — stores the opt-in, consuming discountedPrice's cart total (covers Newsletter opt-in)

### isValidEmail

- unit: src/email/validate.test.ts — rejects a malformed address, consuming the opt-in profile (covers Email validation)
`,
    },
    violation: {
      ".gtd/ARCHITECTURE.md": `## Interfaces

\`\`\`ts
export const discountedPrice = (price: number): number
export const newsletterOptIn = (userId: string): boolean
export const isValidEmail = (email: string): boolean
\`\`\`

## E2E Scenarios

- e2e: tests/features/signup.feature

\`\`\`gherkin
Feature: Signup
  Scenario: A malformed email is rejected
    When I sign up with "not-an-email"
    Then the signup is rejected
\`\`\`

## Unit Tests

### discountedPrice

- unit: src/pricing/discount.test.ts — applies the discount (covers Discount price badge)

### newsletterOptIn

- unit: src/profile/newsletter.test.ts — stores the opt-in, consuming discountedPrice's cart total (covers Newsletter opt-in)

### isValidEmail

- unit: src/email/validate.test.ts — rejects a malformed address, consuming the opt-in profile (covers Email validation and normalization)
- unit: src/email/validate.test.ts — lowercases and trims before comparing (covers Email validation and normalization)

## Merged Concerns

Email validation (Reject a signup form submission whenever \`isValidEmail\`
returns false.) and email normalization (Lowercase and trim an email address
in \`isValidEmail\` before it is ever compared or stored, so two
differently-cased submissions of the same address never collide.) were
merged: both center on \`src/email/validate.ts\`.
`,
    },
  },
  expect: {
    clean: {
      gtdFiles: {
        exact: [],
        matching: { pattern: "^\\.gtd/packages/\\d\\d-[a-z0-9-]+\\.md$", count: 4 },
      },
      otherFiles: "none",
      declaredTests: DECLARED_TESTS,
    },
    violation: {
      gtdFiles: {
        exact: [],
        matching: { pattern: "^\\.gtd/packages/\\d\\d-[a-z0-9-]+\\.md$", count: 4 },
      },
      otherFiles: "none",
      declaredTests: DECLARED_TESTS,
    },
  },
})
