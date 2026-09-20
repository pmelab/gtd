// Test-support for `Blocks.test.ts`: `blockNodesOf` takes an already-parsed
// tree, but a test only has raw markdown source — re-exporting the shared
// parser here (rather than `Blocks.test.ts` reaching into `MarkdownTree.ts`
// directly) keeps the boundary rule "a test reaches a neighbour only through
// its own fixture or the boundary's index.ts" satisfied.
export { parseMarkdown } from "./MarkdownTree.js"
