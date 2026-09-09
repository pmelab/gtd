# Architecture

Four packages, in build order. Package 01 establishes the invariant packages 02
and 03 both lean on: the served step is a human rest carrying a known `file` and
a registered `mode`, captured once at startup.

## Open Questions

### How does a closed tab end `gtd ui`, now that `pagehide` cannot tell a reload from a close?

- [ ] Keep the `/close` beacon, add a grace window — the server arms a timer on
      `POST /close` and any later HTTP request cancels it; a reload's own `step`
      query lands inside the window and the process lives, a real close never
      comes back and it exits 0. Window length becomes a `ui.closeGrace` config
      key (default 90s) so the existing close scenario can set it to 1s instead
      of waiting.
- [x] Delete the beacon and `/close` entirely — `gtd ui` then ends only through
      `done` or a signal, and the outer loop that spawned it owns killing it. No
      false positive is possible because no heuristic exists; the cost is an
      abandoned tab leaving a bound port until something signals the process.
- [ ] _your answer_

### Where does free text live between keystroke and commit?

- [x] Debounced write-through to the real file — 800ms after the last keystroke,
      serialized trailing-edge (never two writes in flight for one anchor), plus
      commit on blur and on unmount. No new persistence layer, the file stays
      the single source of truth, and the CAS tokens the mutations already
      refetch on settle carry the next write. Cost: a `setValue` per typing
      pause over the tailnet.
- [ ] Restore a client-side draft layer — text lands in `localStorage` on every
      keystroke and is rehydrated on mount; the file is written only on an
      explicit commit. Survives a reload and a crash with zero network traffic,
      and re-introduces the divergence `drafts.ts` was deleted for: a draft on
      disk that the steering file does not have.
- [ ] _your answer_

## Merged Concerns

Package 03 merges requirement 2 and requirement 3. Both center on the same files
— `src/web/screens/Question.tsx`, `src/web/screens/Review.tsx`,
`src/web/screens/Plan.tsx`, `src/web/NoteSheet.tsx`, `src/web/api.ts` and their
stories — and they collide inside the same hunks: requirement 2's "every refusal
reaches the human" and requirement 3's "revert-on-rejection restores a stale
snapshot" are two changes to the identical `.catch(() => revert(previous))`
handlers in `Question.tsx#247` and `Review.tsx#148`. Splitting them means one
package writes those handlers and the next rewrites them. Both requirements are
carried verbatim below so spec review still covers each independently.

### Requirement 2, verbatim

PRODUCT. **Every write refusal is now invisible.** The `doneRefused` banners are
deleted from both screens, `onDoneNote` swallows every error
(`.catch(() => {})`, `src/web/screens/Plan.tsx#497`), and
`onSetValue`/`commitAnchor` catch and silently revert. A `stale-token` on a tick
makes the checkbox flick back with **zero explanation**. This is a regression
against the base commit, which showed one banner.

`writeRefusalFrom` and `WriteRefusalInfo` (`src/web/api.ts#33`) survive and name
exactly the six refusal reasons, with **no caller anywhere in `src/web`** —
their only consumer was the deleted `drafts.ts`. Wire them to a banner, or
delete them with their tests; `fallow` currently scores them live only through
`api.test.ts`.

**A blank white screen is the universal failure mode.** `src/web/App.tsx#28`
returns `null` for query-in-flight, query error, dead server and file-less step
alike — no spinner, no error surface, no `aria-busy`. First paint on a phone
over a tailnet is a blank page. `mode={step.mode ?? ""}` (`App.tsx#36`) forwards
an empty mode into `readSteeringFile` and every mutation, whose
`unsupported-mode` refusal then displays nothing.

Accessibility rides in the same work: `HandedBackPanel`
(`src/web/screens/Review.tsx#429`) is a bare `div` with no
`role="status"`/`aria-live`, so the one state change that matters most is
unannounced; the free-text textarea has a placeholder and no label; and
blur-to-commit has no saving/saved affordance, which on touch means blur is
invisible and the human cannot tell whether the answer landed.

Delete, do not move, the "why fallow scores this untested" paragraph now copied
into six files (`Deck.tsx#41`, `Mic`, `Plan` ×3, `Review` ×2, `Hunk`,
`Question`) — one shared note became six near-identical ones.

**Acceptance**: a story where `setValue` rejects with `stale-token` asserts a
visible, named reason on screen, and a story where `trpc.step` is in flight
asserts something other than an empty document. Both fail today.
`Question.stories.tsx` is untouched by the branch, so `onCommitAnswer` has no
coverage at its own layer; it gains it here.

### Requirement 3, verbatim

PRODUCT. **`pagehide` fires on reload, not only on close — so pull-to-refresh on
the phone kills `gtd ui`.** `src/web/main.tsx#18` beacons `POST /close`, and
`/close` responds 204 and calls `endServer()` immediately with none of
`handOff`'s grace. The reload lands on a dead port and a blank page. On iOS
Safari, `visibilitychange`/`hidden` from an app switch or a screen lock is a
further false-positive candidate for the same beacon. Two stories claim the
opposite and prove only that a fresh React mount reads `checked` back off the
server — they mock away the very process a real reload has just terminated
(`Plan.stories.tsx#718`, `Review.stories.tsx#711`), so package 03's "survives a
page reload" acceptance is satisfied only against a mock.

**Free text is lost if the textarea is never blurred.**
`src/web/screens/Question.tsx#118` commits on blur only, and `NoteSheet.tsx#47`
holds note text in plain `useState` with no autosave at all. Tab close, screen
lock, or an unmount without a blur event discards it — and `drafts.ts`, the
local persistence layer, is deleted. Combined with the beacon, one mis-tap on
refresh discards in-flight typing **and** ends the session.

**An answer cannot be cleared.** `Question.tsx#264` returns early on empty text,
so deleting a previously written free-text answer and blurring leaves the old
text on disk while the UI shows an empty textarea — silent divergence. The guard
is right for a mis-tap and wrong for a deliberate erase, and no gesture
distinguishes them today.

**Revert-on-rejection restores a stale snapshot.** `Question.tsx#247` captures
`previous` at call time and `Review.tsx#148` captures a `previous` Map; a slow
rejection restores it wholesale, clobbering anything the human did in the
interim. Tick A, tick B, A's write fails, B's tick vanishes too — realistic on a
flaky tailnet.

**Acceptance**: a real-process `ui-lifecycle` scenario that reloads the page and
then completes a hand-off — the server is still alive and exits 0 through
`done`, not through the beacon. Plus the positive free-text path as a story —
type, blur, exactly one `setValue` carrying `checked` and `text` together —
which has no coverage anywhere despite being package 03's stated acceptance. The
beacon is registered at module top level in `main.tsx` and so is not injectable;
it moves behind something a story can drive.

## 01 — Gate `gtd ui` on a human rest, and end the server when that rest moves

Primary paths: `src/ui/Server.ts`, `src/ui/Beat.ts`, `src/ui/Server.test.ts`,
`src/ui/Beat.test.ts`, `tests/integration/features/ui.feature`.

**The predicate moves off `kind` entirely.** `isRenderable` becomes, in order:
not `idle`, `actor === "human"`, `file !== undefined`, `mode !== undefined`,
`steeringFormatFor(mode) !== undefined`. `kind` is never read. This is the same
axis `verifyForWrite` already gates on (`actorAt !== "human"` → `not-resting`),
so startup and write agree for the first time.

**`refusalFor` takes `StepRead`** — the hand-written
`Step | { status: "broken"; detail: string }` union is deleted, not widened.
Four refusal sentences, checked in this order so the narrower cause always wins:

- broken — unchanged: `this worktree can't be read: <detail>`
- idle — `"<label>" is idle, so there is nothing to hand back`. Checked before
  the actor test on purpose: an idle worktree reports `actor: human`
  (`ui.feature#43`'s own fixture), so an actor-only test would bind a port on a
  finished worktree
- non-human actor —
  `"<label>" rests with the <actor>, which has no phone screen`, `<actor>`
  substituted verbatim (`agent`, `check`)
- human rest with no usable steering file —
  `"<label>" rests with you, but its steering file has no phone screen`, with a
  hint naming the missing or unregistered `mode`

Every one of `ui.feature`'s eight refusal scenarios keeps refusing and every one
has its asserted stderr edited onto the new sentence. None is deleted. Exit
stays 2 (`GtdUsageError`), and the exit-code set stays closed at five numbers.

**Mid-flight staleness ends the process, it does not re-render.** `Step` gains
`readonly state: string` — the beat already parses `state` (`Beat.ts#190`) and
today only folds it into `label`'s fallback, so this exposes a stable identity
rather than making prose the key. `Server.ts` captures the served `state` at
startup, and the `step` procedure compares every read against it. On a mismatch
— including a read that has gone `broken` or stopped being renderable — the
procedure returns `{ status: "moved-on", label }` and calls the SAME idempotent
`endServer()` the `done` path resolves. Exit 0, one step one exit, exactly as
the settled doctrine says.

**No background poll.** Detection rides the `step` query the client already
issues; nothing spawns `gtd next --json` on a timer. Requirement 4 records
subprocess amplification as an accepted, unfixed risk — adding a polling timer
would make that risk worse to fix a case the next client read catches anyway.

**This package does not touch `Write.ts`, `endServer`'s body, or `CLOSE_PATH`.**
Package 02 edits `Write.ts`'s path gate and package 03 edits the close
semantics; keeping 01's lifetime work to a startup capture plus a comparison
inside the `step` resolver leaves both of those as clean, non-overlapping edits.

**Acceptance**: a new `ui.feature` scenario resting at a human state with a
`file` and `mode: qa` — the shape of `await-review` — binds a port and exits 0,
failing today with exit 2. A `Server.test.ts` case where the second `step` read
reports a different `state` asserts `moved-on` and a resolved handoff deferred.

## 02 — Shell safety and confinement inside the served worktree

Primary paths: `src/ui/Tls.ts`, `src/ui/Diff.ts`, `src/ui/SafePath.ts`,
`src/ui/ReadSteeringFile.ts`, `src/ui/Server.ts`, `src/ui/Beat.ts`, plus a new
`src/ui/Shell.ts` and its test.

**One shared quoting helper, no new subprocess port.** `src/ui/Shell.ts` exports
`singleQuoted(value: string): string`, wrapping in `'…'` with `'` → `'\''`.
`Tls.ts` runs `host` through it in `-subj`, in `subjectAltName`, and for both
temp paths; `Diff.ts` runs `base` through it and deletes its own inline copy of
the same escape in favour of the shared one. `CommandRunner` exposes only
`bash(command)`, so an argv array means a new port method plus a Live
implementation plus every test double in the repo — quoting reaches the same
guarantee against a `.gtdrc`-supplied `ui.host` at a fraction of the blast
radius. A `host` containing `/` or `=` can still confuse openssl's own `-subj`
parsing; that is a failed certificate request with a named error, not code
execution, and is accepted.

**The private key never outlives the call.** `generateSelfSignedCert` wraps
everything after `mkdtempSync` in
`Effect.ensuring(Effect.sync(() => rmSync(dir, { recursive: true, force: true })))`,
so the openssl failure path, the read-back failure path and the interrupt path
all remove the tmpdir. The success-path-only `rmSync` at `Tls.ts#87` is deleted.

**`resolveWithinRoot` compares segments and resolves symlinks.** Two changes,
one function, still synchronous (all four call sites are sync, ahead of
`Write.ts`'s `enqueue`):

- containment test becomes `relative(root, candidate).split(sep)[0] !== ".."`
  instead of `startsWith("..")`, so a legitimate `..foo` resolves and a real
  escape still refuses
- the candidate is `realpathSync`'d before the test, walking up to the nearest
  existing ancestor when the leaf does not exist yet and re-appending the tail,
  so a not-yet-created file is still checked and an `ENOENT` never becomes a
  throw. `root` is `realpathSync`'d too — a worktree reached through a symlinked
  parent must not refuse its own files. Any other `realpath` error refuses

That closes all four gates at once (`Write.ts#187`, `Write.ts#214`,
`ReadSteeringFile.ts#53`, `Diff.ts#158`), since every one already calls this
single function.

**Reads and writes are confined to the served step's own file.** The gate lives
in `Server.ts`'s `createContext`, not inside each function: the context already
closes over `cwd.root`, and package 01's startup capture gives it `step.file`
narrowed to a `string`. The `readSteeringFile`, `writeNote` and `writeValue`
wrappers each refuse when `request.filePath !== step.file`. The requirement
names only reads; writes get the identical one-line check because the same hole
is there and the check is free. The refusal reason is the existing
`file-vanished` — no seventh value joins `WriteRefusalReason`, because a seventh
reason means a seventh display sentence in package 03 for a case only a
hand-rolled client can reach.

**`--dev` builds once, at startup.** `rebuildDevClientScript` moves ahead of
`httpsServer.listen`, its result held for the process's lifetime; the
per-request path and the "read fresh off disk every call" comment are both
deleted. The server lives for exactly one step, so a mid-step rebuild has
nothing to reflect, and no HTTP request can spawn a build any more.

**Two comments come out.** `resolveBindHost`'s claim that the refusal exists
because the server "must never silently appear on the LAN" is rewritten to say
the tailnet binding is the boundary and an explicit `--host`/`ui.host` is the
user's own consent, overriding it deliberately. The behaviour is untouched —
`--host 0.0.0.0` stays honoured. `Beat.ts#18`'s pointer at the deleted
`BeatCache` is deleted.

**Risk, blunt, unfixed**: no throttle and no concurrency cap on
`gtd next --json`. Every `step` read and every write still spawns a ~0.5s bundle
parse, where the deleted `BeatCache` capped it at 8 live spawns. Request
flooding is subprocess amplification reachable by anything on the tailnet.
Moving the `--dev` build to startup removes the single most expensive amplifier;
the beat spawns themselves stay uncapped and out of scope.

**Acceptance**: a unit test with `ui.host` set to a command-substitution string
asserts no shell execution and a failed certificate request; a unit test with a
symlink inside the root pointing outside it asserts both the read and the write
refuse; a unit test asserts `readSteeringFile` with `filePath: ".git/config"`
refuses. All three pass a malicious value today. No test asserts a refused bind
host, because there is none to refuse.

## 03 — Every refusal reaches the human, and nothing typed is silently lost

Primary paths: `src/web/App.tsx`, `src/web/api.ts`, `src/web/main.tsx`,
`src/web/NoteSheet.tsx`, `src/web/screens/*.tsx` and their stories, plus a new
`src/web/Refusal.tsx`; `src/ui/Server.ts` (`CLOSE_PATH` only),
`src/ConfigSchema.ts`, `docs/cli.md`,
`tests/integration/features/ui-lifecycle.feature`.

**One refusal surface, six sentences.** New `src/web/Refusal.tsx` exports a
`RefusalBanner` and the `useRefusal()` hook holding the current
`WriteRefusalInfo | "unknown" | undefined`. `writeRefusalFrom` and
`WriteRefusalInfo` are kept and finally get real callers: one sentence per
reason (`stale-token` naming which token moved, `not-resting`, `file-vanished`,
`anchor-unresolved`, `note-collision`, `unsupported-mode`), plus a seventh
generic sentence for an error `writeRefusalFrom` cannot read — a network failure
or a dead server — which today produces the same silence. The banner carries
`role="status" aria-live="polite"` and a dismiss control, and sits at the top of
both `Plan` and `Review`. Every `.catch(() => revert)` in `Question.tsx`,
`Review.tsx` and `Plan.tsx` becomes `.catch(e => { revert(); show(e) })`, and
`onDoneNote`'s `.catch(() => {})` becomes the same — it may still never rethrow,
because `NoteSheet`'s `onDone` is not awaited, but it stops discarding the
reason.

**`App.tsx` never returns `null`.** Five branches, each rendering something:
in-flight (`aria-busy="true"` skeleton), query error (named failure),
`status: "broken"` (the `detail` verbatim), package 01's `moved-on` (the turn
has moved on, the server is exiting), and the openable rest. The `openable`
predicate is tightened to require `mode !== undefined` as well as `file`, so
`mode={step.mode ?? ""}` is deleted rather than papered over — an empty mode can
no longer reach `readSteeringFile` and produce an invisible `unsupported-mode`.

**Accessibility rides along.** Both `HandedBackPanel` copies get
`role="status" aria-live="polite"`; the free-text textarea and the note sheet's
textarea each get a real `<label>` alongside the placeholder; and the commit
path gets a live "Saving…" / "Saved" affordance, announced through the same
`aria-live` region, so a blur that is invisible on touch still reports whether
the write landed.

**The six copied "why fallow scores this untested" paragraphs are deleted.** All
six, not consolidated into a seventh. The machine-read
`// fallow-ignore-next-line` pragmas stay — tooling reads those.

**Free text commits without a blur.** Mechanism follows the second open
question. Either way three things change in `Question.tsx` and `NoteSheet.tsx`:
a commit fires on unmount as well as on blur, the note sheet stops being the
only text with no durability at all, and the empty-text guard is replaced. The
guard moves off "is the text empty" onto "did the text change from what was last
committed": a bare focus-then-blur still writes nothing, and deleting an
existing answer writes the erase. **Implementation checkpoint**: clearing sends
`text: ""` with `checked: false`, which `OpenQuestions.ts`'s `apply` must treat
as an erase of both — if it cannot express that today, extending
`QA_FORMAT.apply` is part of this package, not a follow-up.

**Revert-on-rejection stops clobbering.** No handler snapshots whole state any
more. Each write is stamped with a per-anchor sequence number held in a
`useRef<Map<string, number>>`; a rejection reverts a key only when the failed
write is still the latest issued for that key. Tick A, tick B, A fails — B
stands. This replaces `Question.tsx#247`'s whole-`answer` snapshot and
`Review.tsx#148`'s `previous` Map alike.

**The beacon becomes injectable and its trigger changes.** `main.tsx`'s
top-level `window.addEventListener("pagehide", …)` moves behind an exported
`registerHandOffBeacon(target)` a story can drive. Its server-side counterpart
follows the first open question; under the grace-window answer, `Server.ts`'s
`CLOSE_PATH` handler arms a timer instead of calling `endServer()`, any
subsequent HTTP request clears it, and the window is a new `ui.closeGrace`
config key (seconds, default 90) added to `UiSchema`, its `uiJsonSchema` and
`docs/cli.md`'s config table. 90 seconds is chosen against the asymmetry: a
window too short kills a live turn when a phone screen locks, a window too long
only makes the outer loop wait after a real close. The existing "closing the UI
without handing off exits 0" scenario sets `ui.closeGrace: 1` so it does not sit
for 90 seconds. Nothing listens to `visibilitychange`, then or now.

**Acceptance**: a story where `setValue` rejects with `stale-token` asserts a
visible, named reason on screen; a story with `trpc.step` in flight asserts a
non-empty document; `Question.stories.tsx` gains its first `onCommitAnswer`
coverage — type, blur, exactly one `setValue` carrying `checked` and `text`
together; a story asserting a rejected write for anchor A leaves a later tick on
anchor B standing; and a real-process `@live` `ui-lifecycle` scenario that
closes, re-requests, and then hands off, exiting 0 through `done` rather than
through the beacon. The two mocked "survives a page reload" stories are
rewritten or deleted — they prove only that a fresh React mount re-reads the
server.

## 04 — Take the graft agent tooling off this branch

Primary paths: `.claude/helpers/graft-hooks.cjs`,
`.claude/helpers/graft-statusline.cjs`, `.claude/settings.json`, `.mcp.json`,
`.claude/skills/graft/SKILL.md`, `.ignore`, `mise.lock`.

Pure revert, no code. Both helper scripts, the vendored 172-line skill, and
`.mcp.json` are deleted outright. `.claude/settings.json` loses the four graft
hooks, `statusLine`, `subagentStatusLine`, `footerLinksRegexes`, and the four
allowlist entries (`Bash(graft:*)`, `Bash(npx graft:*)`, `Bash(graft-dev:*)`,
`Bash(node dist/cli.js:*)`) — restored to whatever the base commit had, not
hand-edited toward it. `.ignore`'s `!graft/` line goes with them.

`mise.lock` is kept but does not ride this branch: it is a real reproducibility
improvement alongside the existing `mise.toml` and is committed on its own,
unrelated to `serve` → `ui`.

**Risk, blunt**: this disables tooling the author is using in this worktree
right now. It is taken off the branch, not out of existence — de-hardcoding
`BAKED`'s machine-local absolute path and moving the hooks to user settings is a
branch of its own.

**Acceptance**: `git diff <base>..HEAD --name-only` names no path under
`.claude/`, no `.mcp.json` and no `.ignore`. `npm test` is unaffected either
way, so this package is last and blocks nothing.

## Answered Questions

### What identifies "the rest changed" — the label, the file, or the state name?

The state name. The beat already parses `state` and today only uses it as a
fallback for `label`; exposing it on `Step` gives a stable machine identity,
where `label` is prose a workflow edit can reword without the rest actually
moving.

### Does the write path also gate on the served state, not just the actor?

No. `writeNote`/`writeValue` keep their `actorAt` gate unchanged. The
compare-and-swap tokens already refuse a write whose file moved, and package 02
confines every write to the served step's own file — a second state-identity
gate would refuse nothing those two miss.

### Escape the shell strings, or give `CommandRunner` an argv method?

Escape. `CommandRunner` exposes only `bash(command)`, so an argv method adds a
port method, a Live implementation, and an update to every test double in the
repo. A shared `singleQuoted` helper reaches the same guarantee against a
`.gtdrc`-supplied `ui.host` at a fraction of the blast radius.

### Does a path-confinement refusal get its own reason on the wire?

No — it reuses `file-vanished`. A seventh `WriteRefusalReason` obliges package
03 to write a seventh display sentence for a case only a hand-rolled client can
reach.

### Does `--dev` still rebuild the client per request?

No. The build moves to startup and its result is held for the process's
lifetime. The server serves exactly one step, so there is nothing a mid-step
rebuild could reflect, and no HTTP request can spawn a subprocess build.

### Does the server poll for a rest change while it is up?

No. Detection rides the `step` query the client already issues. A polling timer
would worsen the uncapped `gtd next --json` spawning that package 02 records as
an accepted risk, to catch a case the next client read catches anyway.

### Which package owns the ordering dependency between the client and the server?

The server packages go first: 01 establishes the human-rest invariant with a
narrowed `file`/`mode`, 02 consumes it for path confinement and may adjust the
refusal vocabulary, and only then does 03 write the client's display for that
final vocabulary. Package 04 is last, per its own requirement.
