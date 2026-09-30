// Test-support for `Inline.test.ts`: `projectInline` takes already-parsed
// phrasing content, but a test only has raw markdown source — re-exporting
// the shared parser here (rather than `Inline.test.ts` reaching into
// `MarkdownTree.ts` directly) keeps the boundary rule "a test reaches a
// neighbour only through its own fixture or the boundary's index.ts"
// satisfied.
export { parseMarkdown } from "./MarkdownTree.js"
