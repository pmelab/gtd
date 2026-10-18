## correctness (nit): test-less package scenario would pass without `SATISFIED.md`, and its closing assertions are tautological

`tests/integration/features/declared-tests.feature`, scenario "a package with no
Tests section closes on SATISFIED.md alone":

- With no `## Tests`, `requireDeclaredTests` returns before it reads
  `.gtd/SATISFIED.md`. Nothing on the build→health→closing path checks that the
  file exists. Drop the `Given a file ".gtd/SATISFIED.md"` step and every
  assertion still holds, so the scenario does not pin "closes on SATISFIED.md
  alone". It only shows that an empty-diff build of a test-less package lands.
- The final `".gtd/packages/01-widget.md" does not exist` and
  `".gtd/SATISFIED.md" does not exist` assertions check files the scenario
  deleted itself three lines earlier (closing is simulated). They cannot fail,
  and they read as if closing removed the files.

Fix: rename the scenario to say what it pins (a test-less package lands with no
code diff and runs through closing), or drop the two `does not exist` lines.
Requirement 4's "closing removes the package file and SATISFIED.md" is pinned
only if a unit test checks `packageItem`'s `removeScript` list, which already
includes `.gtd/SATISFIED.md`.

## correctness (nit): the lookup-count test is tied to how `toChanges` is built

`src/workflows/feature/packages.test.ts`, "looks each declared path up once":
the fixture patches `list.find` on the raw `changesSince` array. That only
counts lookups because `toChanges` in `src/flows/runtime.ts` happens to close
over that same array and calls `list.find` once per `get`. Change `toChanges` to
use a `Map` or its frozen copy, and the count drops to 0 and the test reds even
though the guard has not changed. The fixture's own
`Object.assign(list, { paths: [], get: () => undefined })` is dead, because
`toChanges` replaces both. It also reads as if every `get` returns `undefined`,
which would make the "restore" tests impossible.

Fix: drop the dead `paths`/`get` assignment, and count lookups in the fixture's
`read`/`changesSince` without patching `Array.prototype.find` semantics. If that
can't be done, delete the lookup test: concern 5 is a refactor with no behaviour
to observe.
