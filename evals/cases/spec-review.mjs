// The one eval case bundled today: `packages.item.spec.review`, the per-package
// spec-review gate. Two-sided by construction — `violation` must produce
// `.gtd/SPEC_FEEDBACK.md` naming `plantedIdentifier`, `clean` must stay silent.
// See evals/fixture.mjs for how `base`/`variants` become a fixture repo.
export default Object.freeze({
  name: "spec-review",
  state: "packages.item.spec.review",
  plantedIdentifier: "DivisionByZeroError",
  base: {
    ".gtd/NEXT.md": `# Package: safe-divide

## Requirements

\`src/safeDivide.ts\` exports \`safeDivide(a: number, b: number): number\`. When
\`b\` is \`0\` it MUST throw \`DivisionByZeroError\` (a custom \`Error\` subclass
exported from the same file) rather than returning \`Infinity\` or \`NaN\`.
Otherwise it returns \`a / b\`.

## Acceptance

- [ ] \`safeDivide(4, 0)\` throws \`DivisionByZeroError\`
- [ ] \`safeDivide(10, 2)\` returns \`5\`
`,
    "src/safeDivide.ts": `export class DivisionByZeroError extends Error {}

export const safeDivide = (_a: number, _b: number): number => {
  throw new Error("not implemented")
}
`,
  },
  variants: {
    // Never throws DivisionByZeroError — returns Infinity/NaN instead, the
    // exact defect the spec forbids.
    violation: {
      "src/safeDivide.ts": `export class DivisionByZeroError extends Error {}

export const safeDivide = (a: number, b: number): number => a / b
`,
    },
    clean: {
      "src/safeDivide.ts": `export class DivisionByZeroError extends Error {}

export const safeDivide = (a: number, b: number): number => {
  if (b === 0) throw new DivisionByZeroError("division by zero")
  return a / b
}
`,
    },
  },
  expect: {
    violation: { feedback: true },
    clean: { feedback: false },
  },
})
