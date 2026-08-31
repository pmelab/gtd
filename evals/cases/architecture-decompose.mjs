// `architecture.decompose`: the mechanical write-out from a converged
// `.gtd/ARCHITECTURE.md` into one package file per settled concern. No
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
export default Object.freeze({
  name: "architecture-decompose",
  state: "architecture.decompose",
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
      ".gtd/ARCHITECTURE.md": `## Discount price badge

TECHNICAL. Read the discounted price straight off \`discountedPrice\` and
render a badge next to it wherever a price is shown. Touches
\`src/pricing/discount.ts\`.

## Newsletter opt-in

TECHNICAL. Add a toggle on the profile page that flips
\`newsletterOptIn\`'s stored value for the current user. Touches
\`src/profile/newsletter.ts\`.

## Email validation

TECHNICAL. Reject a signup form submission whenever \`isValidEmail\` returns
false. Touches \`src/email/validate.ts\`.
`,
    },
    violation: {
      ".gtd/ARCHITECTURE.md": `## Discount price badge

TECHNICAL. Read the discounted price straight off \`discountedPrice\` and
render a badge next to it wherever a price is shown. Touches
\`src/pricing/discount.ts\`.

## Newsletter opt-in

TECHNICAL. Add a toggle on the profile page that flips
\`newsletterOptIn\`'s stored value for the current user. Touches
\`src/profile/newsletter.ts\`.

## Email validation and normalization

TECHNICAL. Reject a signup form submission whenever \`isValidEmail\` returns
false. TECHNICAL. Lowercase and trim an email address in \`isValidEmail\`
before it is ever compared or stored, so two differently-cased submissions
of the same address never collide. Touches \`src/email/validate.ts\`.

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
        exact: [".gtd/ARCHITECTURE.md"],
        matching: { pattern: "^\\.gtd/packages/\\d\\d-[a-z0-9-]+\\.md$", count: 3 },
      },
      otherFiles: "none",
    },
    violation: {
      gtdFiles: {
        exact: [".gtd/ARCHITECTURE.md"],
        matching: { pattern: "^\\.gtd/packages/\\d\\d-[a-z0-9-]+\\.md$", count: 3 },
      },
      otherFiles: "none",
    },
  },
})
