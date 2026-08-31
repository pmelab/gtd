// `architecture.author`: converts settled REQUIREMENTS.md concerns into an
// ARCHITECTURE.md, with sole authority to MERGE concerns whose footprints
// center on the same files. Two-sided on that merge decision: `violation`'s
// two concerns both center on the same file and MUST be merged under a
// well-formed `## Merged Concerns` heading; `clean`'s concerns touch
// disjoint files and that heading MUST NOT appear.
export default Object.freeze({
  name: "architecture-author",
  state: "architecture.author",
  plantedIdentifier: "src/pricing/discount.ts",
  artifact: ".gtd/ARCHITECTURE.md",
  base: {
    "src/pricing/discount.ts": `export const discountedPrice = (price: number): number => price
`,
  },
  variants: {
    violation: {
      ".gtd/REQUIREMENTS.md": `## Show discount price badge

PRODUCT. Add a "discount" badge showing the discounted price wherever a
product's price is shown. Touches \`src/pricing/discount.ts\`.

## Suppress discount badge for out-of-stock items

PRODUCT. An out-of-stock item must never show the discount badge — only its
normal price. Touches \`src/pricing/discount.ts\`.
`,
    },
    clean: {
      ".gtd/REQUIREMENTS.md": `## Show discount price badge

PRODUCT. Add a "discount" badge showing the discounted price wherever a
product's price is shown. Touches \`src/pricing/discount.ts\`.

## Weekly newsletter opt-in

PRODUCT. Let a user opt in to a weekly newsletter from their profile page.
Touches \`src/profile/newsletter.ts\`.
`,
    },
  },
  expect: {
    violation: {
      gtdFiles: [".gtd/ARCHITECTURE.md", ".gtd/REQUIREMENTS.md"],
      otherFiles: "none",
    },
    clean: {
      gtdFiles: [".gtd/ARCHITECTURE.md", ".gtd/REQUIREMENTS.md"],
      otherFiles: "none",
    },
  },
})
