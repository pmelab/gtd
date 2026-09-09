# Spec feedback — 02 Shell safety and confinement

Tasks 2–7 are met. One problem in Task 1.

## Task 1 — two byte-identical shell-quoting helpers now exist

`src/ui/Shell.ts#singleQuoted` is character-for-character the same
implementation as the pre-existing `src/GitScript.ts#shellQuote`
(`` `'${value.replace(/'/g, "'\\''")}'` ``), which is exported and already used
across `src/GitScript.ts` and `src/Emit.ts`. The task's own heading is "One
shared quoting helper"; the package shipped a second one.

Consequence: a security-critical escape has two copies, so a future correction
to one silently misses the other, and `src/ui/Shell.test.ts` re-covers ground
`src/GitScript.test.ts#shellQuote` already property-tests against real `bash`.

Fix, without contradicting the spec's Paths list (which mandates
`src/ui/Shell.ts` and `src/ui/Shell.test.ts`): keep both files, but make
`singleQuoted` delegate to — or re-export — `GitScript.ts#shellQuote` so exactly
one implementation exists. Adjust `Shell.ts`'s doc comment, which currently
reads as if this were the repo's only such escape.
