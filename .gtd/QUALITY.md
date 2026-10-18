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

## spec-challenge: kept `turn = "fix"` default holds; test-audit finding 1 contradicts it on a false premise

`src/workflows/feature/packages.ts#99-103`, `.gtd/QUALITY.md` test-audit
finding 1.

Spec decision (REQUIREMENTS at `f6e62b53`, ARCHITECTURE at `645396e0`): the
human overrode the review note, keeps `requireDeclaredTests`'s `turn = "fix"`
default, and pins it with a unit test.

Checked against invariants — no conflict:

- `requireDeclaredTests` IS public: `src/workflows/index.ts` re-exports
  `./feature/packages.js`, and `@pmelab/gtd/workflows` is a public entry in
  `COMPATIBILITY.md`
- released signature (before `08eaee96`) was `(pkg, since)` with no turn split,
  i.e. today's fix-turn behaviour. The `"fix"` default keeps every released
  two-argument call meaning exactly what it meant; making `turn` required, or
  defaulting it to `"build"`, would break or tighten those callers — a breaking
  change per `COMPATIBILITY.md`
- README's "the build turn must not create, edit or delete it" describes the
  bundled workflow, which passes `"build"` explicitly from `packageItem`; the
  default never decides that path

Finding (blocking for the fix turn, not the code):

1. test-audit finding 1 says `requireDeclaredTests` "is not published from any
   `index.ts`" and recommends dropping the default-pinning case, the `"default"`
   sentinel, and ideally making `turn` required. The premise is false (see
   above), and the recommendation reverses the human's explicit override
   recorded in REQUIREMENTS. Do NOT act on it: keep the case, the sentinel and
   the default. Its sub-point 2 (`it.each` so the row label shows in a failure)
   stays a harmless optional nit.
