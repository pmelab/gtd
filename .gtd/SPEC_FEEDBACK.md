# Spec feedback — 04 — steering screens and dictation

Re-verified `64dd325f2a58a6de056fd6d12472d035bc132194`..working tree. Every item
from the previous round is now fixed: `Router.ts` has a `diff` procedure and
`Review.tsx#HunkWithDiff` fetches through it, `reviewView` projects a
chunk-level footnote as `note`, `Plan.tsx`'s seam opens `NoteSheet` on a real
server-computed `paragraph` line, `View.ts` yields paragraphs for a prose-only
file, `Question.tsx` normalizes against
`OpenQuestions.ts#FREE_TEXT_PLACEHOLDER`, `Mic` skips the attach on an empty or
errored session and both consumers render `interim`, and `useScrollRestoration`
is shipped code. `npm test` is green. One thing is left.

## 1. `Hunk.tsx`'s `diff` doc comment states the opposite of the code

`src/web/screens/Hunk.tsx:8-17` still says `src/serve/Router.ts` "has no `diff`
procedure wired to it yet (only `runCommand`/`fleet`/`writeNote`/`view` exist),
so there is nothing for a real container to call yet. A future package adds that
procedure and a container fetches into this prop."

All three claims are now false: `Router.ts` exports a `diff` procedure,
`Review.tsx#HunkWithDiff` is the real container calling it, and no future
package owns it. AGENTS.md makes a comment the one place a non-obvious fact
lives, so a comment asserting a missing feature that exists sends the next
reader looking for work already done. Rewrite it to describe what `diff` is
(`Diff.ts#resolveDiff`'s closed result, `undefined` only while the query is in
flight) — or delete it.
