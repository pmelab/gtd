## test-audit: guard well covered; one new unit case pins a default no production caller uses

`src/workflows/feature/packages.test.ts`,
`tests/integration/features/declared-tests.feature`.

Checked each new/changed test against "fails with the guarded behaviour
removed":

- "refuses a marked test the build added, as added and never as modified" fails
  without the `addedMarked` branch. Real
- "only the build turn refuses an added marked test" fails without
  `turn !== "build"`; its name now says it guards the turn split. Real
- order case fails if the `addedMarked` group moves. Real
- both "lists a duplicated … once" cases fail without `seen`. Real
- "lets an unmarked entry win over a marked one the build added" pins the
  mixed-entry `continue`. Real
- e2e "a build that creates a test marked (unchanged) is refused" (`@inmem`)
  fails pre-fix; "stop and leave it to a person" reaches stderr only through the
  new group. Real
- `text.test.ts` pins prompt wording, a prompt-byte contract. Fine
- Earlier-round findings (unreachable fix-turn case renamed, duplicate e2e
  dropped, feature preamble aligned) are resolved

Findings (non-blocking):

1. "defaults to the fix turn when called with two arguments" pins a test-only
   seam. The only caller, `packageItem`, always passes `kind` explicitly, and
   `requireDeclaredTests` is not published from any `index.ts`, so the `= "fix"`
   default has no production caller. The `run` helper grew a `"default"`
   sentinel turn just for this case. Drop the case and the sentinel; ideally
   also make `turn` required so the default cannot silently decide a build turn
   is a fix turn.
2. Same case: `cases: [string, Change][]` labels are destructured away
   (`for (const [, change] …)`), so they document nothing in a failure. Moot if
   (1) is taken; otherwise use `it.each` so the label names the failing row.
