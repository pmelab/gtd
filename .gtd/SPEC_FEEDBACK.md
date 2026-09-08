# Spec feedback — 02 One worktree, one step, one exit

Most of the package landed: the six modules and `drafts.ts` are gone,
`worktreePath` is off every procedure input, `fleet`/`stop`/`runCommand` are
deleted, `GtdUsageError` → exit 2 is wired, `roots`/`loop` are out of the config
struct and `schema.json`, `docs/driver.md`'s spawn section is gone,
`typecheck`/`deadcode`/`npm test` are green. Six problems remain.

## 1. The import-time-throw test is vacuous — it pins nothing

`src/ui/Beat.test.ts:253` ("importing this module with no `@pmelab/gtd`
package.json above it") runs `import("./Beat.js")` from inside this repo, where
a `@pmelab/gtd` `package.json` DOES sit above the module. Restore
`const GTD_VERSION = findOwnVersion()` at module scope and this test still
passes — the condition in its own name is never established. The criterion asks
for an import **from a directory with no `@pmelab/gtd` package.json above it**:
spawn a node/vitest import from a temp dir outside any such tree (or otherwise
make the walk fail), and assert the module loads.

## 2. Handoff exit is delayed ~2s by its own fallback timer

`src/ui/Server.ts#handOff` schedules `setTimeout(settle, 2_000)` and never
clears or `unref`s it. `Cli.ts:1103` deliberately sets `process.exitCode`
instead of calling `process.exit`, so the pending timer keeps the event loop
alive: on the NORMAL path (response flushes, `finish` fires, listener closes)
the process still lingers a full 2 seconds before exiting 0. Every human turn in
the outer loop pays that. `clearTimeout` on `finish`, or `.unref()` the timer.

## 3. "Closes without handing off exits 0" is not implemented

Requirement A's acceptance and the lifecycle task both require _a scenario
closes the UI without handing off and asserts **exit 0** with no note written_.
`tests/integration/features/ui-lifecycle.feature`'s fourth scenario asserts
**143** and argues in a comment that no code path produces exit 0 for a bare
close. That argument is correct about the code — which means the criterion is
unmet in the CODE, not just the feature: with no handoff the server waits on the
deferred forever and only a signal ends it. Either build the close path (a
client disconnect / no-live-client condition resolving the deferred) and assert
exit 0, or get the criterion changed in the spec. A feature comment declining a
criterion is not satisfying it.

## 4. Client-supplied paths still reach the filesystem unvalidated

`worktreePath` is gone, but `writeNote`/`done` (`filePath`), `diff` (`path`) and
`readSteeringFile` (`filePath`) still take client strings that are `join`ed onto
the worktree root with no traversal check (`src/ui/Write.ts:124`,
`src/ui/ReadSteeringFile.ts:50`) or shell-quoted into a `git diff` pathspec
(`src/ui/Diff.ts:161`). `join(root, "../../../x.md")` resolves outside the
served worktree, so the write half of the confirmed path-injection defect
survives the rescope.

`src/ui/Router.test.ts:269`'s
`describe("no procedure input carries a filesystem path from the client")` only
greps for the absence of `worktreePath` — it asserts the field name is gone, not
the property its own title claims. Add containment: reject a `filePath`/`path`
that escapes the worktree root, and assert it.

## 5. Registry residue kept dormant in the client

`src/web/api.ts:51-70` still exports `DriveRefusalInfo`
(`reason: "already-driving"`) and `driveRefusalFrom`, reading
`error.data.driveRefusal`. `Router.ts`'s `errorFormatter` attaches only
`writeRefusal`/`viewRefusal`/`readRefusal`; `already-driving` came from the
deleted `Registry.ts`, so this can never fire.
`src/web/screens/Plan.tsx:481-487` and `Review.tsx:471` still carry the
`doneRefused` state and its banner off that call, plus the
`DoneRefusedShowsAnAlreadyDrivingBanner` stories. That is exactly Requirement
B's "same code with an unused door" — and `fallow` reports clean only because
`src/web/api.test.ts:24` is its entry point, the test-only-entry pattern the
acceptance bullet forbids. Delete it here or say in the spec that package 03
owns it.

## 6. Comments still name deleted modules

Each of these points a reader at a file that no longer exists:

- `src/ui/Beat.ts:52` — "`Fleet.tsx` imports this module's types"
- `src/ui/Write.ts:70` and `:154` — `BeatCache`'s memoized read
- `src/web/testing/TrpcTestProvider.tsx:13` — "`Router.ts` → `Beat.ts` →
  `Discover.ts`"
- `tests/tooling/turbo.test.ts:77-78` — "`Fleet.tsx` imports `src/ui/Fleet.ts`"
- `src/web/Deck.tsx:41`, `src/web/Mic.tsx:46`,
  `src/web/screens/Plan.tsx:63,286,290`, `Hunk.tsx:85`, `Review.tsx:254,360`,
  `Question.tsx:185` — all defer to "`Fleet.tsx#FleetView`'s note on why
  fallow's static CRAP estimate scores it as untested"; that note is gone, so
  the reason is now unrecoverable. Inline the reason once and reference that, or
  drop the sentence.
