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

## ponytail-review (should fix): the lookup-count test passes on the old code too

`src/workflows/feature/packages.test.ts`, "looks each declared path up once".

- **What this is:** concern 5 asks for one `range.get` per declared test. This
  test counts lookups and expects 3 (the package file plus two tests).
- **Problem:** the old line was
  `range.get(p) !== undefined && range.get(p)?.status !== "deleted"`. The test
  gives no diff entry for either declared path, so the first `get` returns
  `undefined` and `&&` skips the second. The old code also counts 3. The test
  would stay green with the refactor reverted, so it pins nothing. This is on
  top of the correctness note that it is tied to how `toChanges` is built.
- **Fix:** delete the test, the `lookups` counter and the `list.find` patch in
  `run`. Concern 5 is a pure refactor with nothing a caller can see. If a count
  is kept, it only means something with a diff entry for a declared path, e.g.
  `run(text, ["b.test.ts"], [modified("a.test.ts")])`, which old code counts
  as 4.
- **If we skip it:** a reader trusts a test that cannot fail, and the fixture
  carries about 10 lines of `Array.prototype.find` patching for it.

## ponytail-review (should fix): the first `requireDeclaredTests` test rebuilds the `run` helper by hand

`src/workflows/feature/packages.test.ts`, "groups an unwritten unmarked test and
a missing marked test in one refusal".

- **What this is:** the change adds a `run(text, tree, changes, satisfied)`
  helper that installs the fixture, calls the guard and catches the message.
- **Problem:** the existing test just above it still builds the same fixture,
  `changesSince` list and try/catch inline. If the fixture's shape changes, both
  copies have to change together.
- **Fix:** move `run`/`deleted` above the first test and write that test as
  `const { message } = run(text, ["lib/kept.test.ts"], [])`, keeping its
  assertions as they are.
- **If we skip it:** two copies of the same fixture drift apart. About 25 lines
  could go.

Verdict (ponytail-review): ship once the two test-only cleanups are done. No
must-fix. The guard logic (marker parse, CR normalisation, blank-line rejoin,
restore group) holds for every case I traced. Lean: about -35 lines possible.
