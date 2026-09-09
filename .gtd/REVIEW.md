# Review: cac07a4

<!-- base: 65b4fc7c2261420a3736cc7f94cede4835a6ecbd -->

`gtd serve` — a long-lived multi-worktree fleet server that spawned loop
commands — becomes `gtd ui`: **one worktree, one step, one exit**. The server
starts on the worktree it is invoked in, refuses to bind on any step it cannot
render, shows that step on a phone, writes the human's ticks and answers
straight to disk, and terminates the process when the human hands back. Net
−1,900 lines: discovery, the fleet screen, the registry, the loop spawner, the
shim, the beat cache and the draft store are all deleted.

Read three things before the rest: **`pagehide` kills the server on a plain page
reload** (chunk 3), **`ui.host` reaches `bash -c` unescaped** (chunk 5), and
**every write refusal is now invisible to the human** (chunk 7). The last chunk
is unrelated tooling that rode along on the branch and should come off it.

`typecheck`, `lint`, `format:check` and `deadcode` are all green.

## The command, its repo guard, and its config key

Straight rename with one behaviour change: `gtd serve` skipped the repo guard
because its roots lived elsewhere; `gtd ui` operates on the invoking directory,
so it takes the same guard every state command takes.

- [ ] ./src/Cli.ts#487 — the command token and `Command["kind"]` become `ui`;
      the help row now says it serves THIS worktree and refuses outside a
      repository
- [ ] ./src/Cli.ts#167 — `--port` scopes to `visualize || ui`; `--host`,
      `--self-signed`, `--dev` each scope to `ui` alone with reworded
      `scopeError` strings
- [ ] ./src/program.ts#1168 — `ui` drops out of `standaloneKinds()` (seven →
      six) and falls through `needsOf` to `"state"`, so it now inherits the
      repo-root and at-least-one-commit guards
- [ ] ./src/program.ts#1059 — `runServeCliCommand` → `runUiCliCommand`, handing
      `config.ui` to `runUiCommand`
- [ ] ./src/ConfigSchema.ts#209 — `UiSchema` keeps only
      `port`/`host`/`cert`/`key`; `roots` and `loop` are gone, and the published
      JSON Schema's property order is pinned
- [ ] ./docs/configuration.md#51 — the `serve:` section becomes `ui:`, six
      settings → four, with the ~25-line `loop` contract deleted
- [ ] ./docs/cli.md#229 — `ui` moves into the "must run from the repository
      root" list; drive-by fix, `uncheck` was missing from the standalone list
      and now matches `standaloneKinds()`
- [ ] ./docs/driver.md#199 — the whole "Being spawned by `gtd serve`" section
      (cwd, `$PATH` shim, SIGINT→SIGKILL, unlimited concurrency) is deleted,
      correctly, since nothing owns that contract now

**Breaking, with no migration note anywhere.** `gtd serve` is now an unknown
subcommand (exit 2), a `serve:` key is a hard config decode failure (exit 1),
and `gtd ui` refuses from a subdirectory or a commitless repo. Anyone running
`gtd serve` from a non-repo directory with configured `roots` finds out at run
time. Neither `docs/cli.md` nor `docs/configuration.md` says "this used to be
`serve:`".

**Spec deviation to bless or reject.** Package 01/02 acceptance says a `serve:`
key and a `ui.loop` sub-key must fail "at exit 2". They exit **1**.

- [ ] ./src/ConfigSchema.ts#190 — the code argues the deviation deliberately:
      every other config decode failure in the CLI exits 1, so a `ui:`-only
      exit-2 exception would be the single inconsistency The argument is right.
      The comment that carries it is not: it opens "Deliberate deviation from
      this package's own T1 prose", and "T1" means nothing to a future reader.
      Keep the fact, delete the history.
- [ ] ./tests/integration/features/ui-lifecycle.feature#238 — the only assertion
      that `ui.loop` is gone, and it pins exit 1

**README is silent on `gtd ui`.** It never mentioned `serve` either, so nothing
went stale — but a new user-facing command exists and the README's command
walkthrough does not know about it. **CONTEXT.md likewise has no entry for the
UI at all**, though this branch renames a user-facing command and adds a write
surface.

## The startup render gate and a new usage-error class

The server now refuses before it binds anything, and that refusal needed an
error class that maps to exit 2.

- [ ] ./src/ui/Server.ts#287 — `isRenderable`: the server starts only on a
      non-idle `prompt` step carrying a `file` and a `mode` that resolves to a
      registered steering format

  This gate admits exactly the wrong half of the workflow. Grep `mode:` in
  `src/workflows/unified.yaml`: of the seven states carrying a mode, the two
  with `actor: human` — `build.review.await-review` and the QA `answer` gate —
  both declare `message:`, so `beatKindOf` reports `message` and this guard
  rejects them. The five it does admit are `actor: agent` or `actor: check`,
  i.e. states no human ever sits at. Result: `gtd ui` cannot start on either
  step it exists for, and starts only mid-agent-turn. Verified on this very
  worktree at `build.review.await-review`: "refuses to start — 'Awaiting your
  review' rests at message, which has no phone screen".

  The whole point of this command is to facilitate the steps where a HUMAN
  provides feedback to a steering file. Gate on that instead of on content kind:
  a human-actor rest whose `file` and `mode` resolve to a registered steering
  format. Note `kind` shifts again once the human starts editing — a `message`
  state with a dirty tree becomes `capture` — so a kind-based test is the wrong
  axis regardless of which kinds it lists.

  The mid-flight staleness already noted below is the same defect seen from the
  other side, and both e2e scenarios covering the refusal (`ui.feature#163`, and
  the `ui-lifecycle` startup cases) pin the current behaviour, so they move with
  the gate.

- [ ] ./src/ui/Server.ts#302 — `refusalFor` builds the `GtdUsageError`, naming
      the step's label and what the worktree rests at
- [ ] ./src/ui/Server.ts#331 — the beat is read **before** host and certificate
      resolution, so a refusal never invokes `openssl` and never binds a port
- [ ] ./src/Commentary.ts#61 — new `GtdUsageError extends GtdError`, keeping the
      remedy lines a `GtdError` renders
- [ ] ./src/Cli.ts#1190 — `report` maps `GtdUsageError` to `EXIT_USAGE_ERROR`
      alongside `SelectorUsageError`; the exit-code closure set is still five
      numbers

**The gate is checked once, at startup.** If the agent or the outer loop
advances state while the server is up, `step` happily reports the new rest to a
client that has no screen for it. `writeNote` still refuses via the actor gate,
so nothing corrupts — but the phone shows a screen for a step that no longer
exists.

- [ ] ./src/ui/Server.ts#302 — `refusalFor`'s parameter type hand-writes
      `Step | { status: "broken" ... }` when the union is already `StepRead`;
      redundant

## Handoff, `/close`, and the one-step process lifetime

The inversion at the heart of the branch: the phone's "Done" no longer spawns a
loop child inside a server that outlives every turn. It writes the note, then
exits the process, and the outer loop reacts to the exit.

- [ ] ./src/ui/Router.ts#282 — `done` awaits the write first; a refused write
      throws `WriteNoteRefusal` and nothing shuts down. On success it calls
      `ctx.handOff()`
- [ ] ./src/ui/Server.ts#379 — `handOff` arms the exit on the HTTP response's
      `finish` event, so the process never dies before the client learns the
      write landed
- [ ] ./src/ui/Server.ts#393 — a **2s fallback timer** resolves the deferred if
      the response never flushes, so a vanished client cannot wedge the process;
      cleared on the normal path
- [ ] ./src/ui/Server.ts#365 — `endServer` relies on `Deferred.succeed` being an
      idempotent no-op, so `done` and `/close` can never race into a double exit
- [ ] ./src/ui/Server.ts#435 — `Deferred.await` replaces the old `Effect.never`,
      with `Effect.ensuring` closing the listener; exit 0
- [ ] ./src/web/main.tsx#19 — the client beacons `POST /close` on `pagehide`, so
      closing the tab without handing off also ends the server's one-step life
- [ ] ./src/ui/Server.ts#44 — `/close` is the one non-tRPC endpoint, because
      `navigator.sendBeacon` sends a plain body, not a tRPC batch envelope

**`pagehide` fires on reload, not only on close — so pull-to-refresh on the
phone kills `gtd ui`.** `/close` responds 204 and calls `endServer()`
immediately, with none of `handOff`'s grace. The reload then lands on a dead
port and a blank page. On iOS Safari, `visibilitychange`/`hidden` from an app
switch or a screen lock is a further false-positive candidate for the same
beacon.

- [ ] ./src/web/screens/Plan.stories.tsx#718 —
      `RealContainerAnAnsweredOptionSurvivesAPageReload` claims the opposite. It
      proves only that a fresh React mount reads `checked` back off the server —
      it mocks away the very process a real reload has just terminated
- [ ] ./src/web/screens/Review.stories.tsx#711 — same shape for a hunk tick,
      same gap Package 03's "an answer survives a page reload" and "a hunk tick
      survives a reload" acceptance bullets are therefore satisfied only against
      a mock. On a real phone, a reload ends the turn.

**`/close` is an unauthenticated remote kill switch.** A cross-origin
`fetch(..., {method:"POST", mode:"no-cors"})` is a CORS-simple request: no
preflight, no auth, response unreadable, side effect lands. Any page the phone
happens to open can terminate the step. No `Origin` check, no CSRF token.

**Handoff does not force sockets closed.** `bound.close()` stops accepting but
never calls `closeAllConnections()`, and `Cli.ts` deliberately sets
`process.exitCode` rather than calling `process.exit`. Idle keep-alive sockets
from the phone hold the event loop until Node's ~5s `keepAliveTimeout`, so
`gtd ui` lingers after handoff — and an actively-held request (a hung `--dev`
rebuild, a stuck `gtd next --json`) can stall the outer loop indefinitely.
Process exit _is_ the handoff signal here, so this deserves its own test.

**The 2s fallback can exit after a successful write the client never learned
about.** The phone sees a network error on a write that landed. Acceptable — but
the client must never blindly retry `done`, and nothing says so.

## Deleting the fleet: discovery, registry, loop spawn, beat cache

Seven modules and their tests come out. This is the bulk of the −1,900 lines and
it is a clean deletion, not a dormant-code retention.

- [ ] ./src/ui/Beat.ts#28 — `findOwnVersion` becomes lazily memoized instead of
      a module-scope `const`, so importing the module outside a `@pmelab/gtd`
      tree no longer throws at load time. This was a confirmed defect in the
      previous review
- [ ] ./src/ui/Beat.ts#249 — `readStep` survives; `FleetRow`/`BrokenRow` are
      `Step`/`BrokenStep`, `FleetKind` is `StepKind` with the same five content
      kinds
- [ ] ./src/ui/Router.ts#10 — `NoWorktreePath<T>` strips `worktreePath` from
      every input type; the server closes over `cwd.root` instead. This is how
      the previous review's confirmed path-injection defect dies
- [ ] ./src/ui/Router.ts#229 — `step` is an input-less query; `fleet`, `stop`
      and `runCommand` are deleted
- [ ] ./src/ui/BindSystem.ts#12 — the real-network call is split out of
      `Bind.ts` purely so three test sites can `vi.mock` it without stubbing
      `pickBindHost`'s pure logic
- [ ] ./src/web/drafts.ts — deleted along with its test; it was already
      unreachable at the base commit, propped up only by its own test counting
      as a `fallow` entry point

**Deleting `runCommand` — an arbitrary `bash -c` over the wire — is the single
biggest security improvement on this branch.**

**Deleting `BeatCache` removed the only throttle that ever existed.** Every
`step` and every `writeNote` now spawns a fresh `gtd next --json` (a ~0.5s
bundle parse) with no cache and no concurrency cap. The old cache capped it at 8
live spawns. With no auth and no request limits, unauthenticated request
flooding is subprocess amplification. One worktree makes this survivable, not
correct.

- [ ] ./src/ui/Beat.ts#18 — the comment points at "`Server.ts`'s
      `findPackageRoot`", and both files still carry their own copy of the same
      8-level package-root walk
- [ ] ./src/CommandRunner.ts#19 — **stale comment describing deleted code**: it
      still says `gtd ui`'s loop command "is spawned by `Loop.ts`'s own port".
      `Loop.ts` is deleted and no loop command exists
- [ ] ./src/ui/Server.ts#172 — **factually wrong comment**: it says `ui`
      "deliberately runs outside" the invoking directory, "see `needsOf("ui")`".
      `needsOf("ui")` returns `"state"`; `gtd ui` requires a repo root and a
      commit, and serves `cwd.root`. The `findPackageRoot` walk it justifies is
      still needed for the installed-bundle case — the stated reason is a
      carry-over from `gtd serve`
- [ ] ./src/ui/Server.ts#357 — comment still reasons about "the never-resolving
      wait a fleet server could get away with"
- [ ] ./src/ui/Router.ts#12 — comment still says `handOff` resolves the deferred
      "in place of `Effect.never`"; `Effect.never` is gone from `Server.ts`
- [ ] ./src/ui/Router.ts#319 — `diff`'s doc comment lists four `DiffResult`
      members; the union has five, `no-changes` included. Confirm the client
      switches on all five

## Path safety on client-supplied file paths, and what is still open

`worktreePath` is off every input, but `filePath` and `path` are still client
strings, so a new gate stands in front of all four consumers.

- [ ] ./src/ui/SafePath.ts#14 — `resolveWithinRoot` resolves against the root
      and rejects on `relative()` escaping it. Correctly refuses
      `../../etc/passwd` **and** an absolute second argument, which
      `path.resolve` would otherwise honour outright
- [ ] ./src/ui/Write.ts#187 — `writeNote`'s gate, refusing before any fs call
- [ ] ./src/ui/Write.ts#214 — `writeValue`'s gate, same shape
- [ ] ./src/ui/ReadSteeringFile.ts#53 — reports an escape as `file-vanished` on
      purpose, so the refusal is not an existence oracle
- [ ] ./src/ui/Diff.ts#158 — refuses with `path escapes the served worktree`

**`resolveWithinRoot` does not resolve symlinks.** No `realpath` anywhere in
`src/ui/`. A symlink _inside_ the worktree pointing outside it passes every
gate; `readSteeringFile` then returns the target's bytes and `writeNote` writes
through it. Worktrees are agent-writable, so the chain is plausible.

**It also refuses a legitimate name.** A file literally called `..foo` inside
the root resolves to relative `..foo`, which trips the `startsWith("..")` check.
Compare path segments, not the string prefix.

**Reads inside the root are unrestricted.** Nothing confines `filePath` to
`.gtd/` or to the step's own `step.file`, and `View.ts`'s dispatch is total over
content. `readSteeringFile({filePath: ".git/config", mode: "qa"})` returns the
raw bytes. Unauthenticated arbitrary read of anything in the repo, `.env`
included.

**`ui.host` reaches `bash -c` unescaped.**

- [ ] ./src/ui/Tls.ts#52 — `-subj "/CN=${request.host}"` and the
      `subjectAltName` line interpolate `host` into a string handed to
      `runner.bash`. `host` comes from `--host` **or `ui.host` in the repo's own
      `.gtdrc`**, so `ui.host: "$(...)"` in a cloned repo executes on the first
      `gtd ui --self-signed`. Escape it, or hand `openssl` an argv array
- [ ] ./src/ui/Tls.ts#87 — the tmpdir holding `key.pem` is removed only on the
      success path; every failure branch leaks the private key in `/tmp` (mode
      0700, so contained but persistent)
- [ ] ./src/ui/Diff.ts#172 — `quotedPath` is properly single-quote-escaped, but
      `base` is interpolated unquoted straight out of `gtd base`'s stdout.
      Pre-existing, still a shell-injection shape

**There is no authentication of any kind, and none was removed.** No token, no
header, no cookie, no `Origin` check, no rate limit. Everything above — read any
repo file, write the steering file, kill the process — is reachable by anyone
who can open a TCP connection.

- [ ] ./src/ui/Server.ts#69 — `resolveBindHost` refuses only when `--host`,
      `ui.host` and the Tailscale CGNAT scan all come up empty. It **never
      validates a supplied host**, so `--host 0.0.0.0` or `ui.host: "0.0.0.0"`
      binds every interface unauthenticated The comment right above it claims
      the refusal exists because "a server that reads and writes working trees
      without authentication must never silently appear on the LAN". The guard
      covers only the default path. The comment is untrue as written.
- [ ] ./src/ui/Server.ts#92 — `resolveCertPair`: `--self-signed` wins; one of
      `cert`/`key` alone is an error; neither is a refusal, never a silent
      `openssl`. TLS stays mandatory (`https.createServer` only)
- [ ] ./src/ui/Write.ts#148 — the compare-and-swap gate (`headSha` + content
      hash + a fresh human-actor check per write) is a **concurrency guard, not
      an authorization one**: a caller who can read via `readSteeringFile` gets
      both tokens in one call. The code says so, correctly
- [ ] ./src/ui/Server.ts#226 — `--dev` shells out `npx tsdown --filter web`
      **per HTTP request**, so an unauthenticated request triggers a build in
      the gtd source checkout
- [ ] ./src/ui/Server.ts#399 — `/trpc` without a trailing slash is forwarded to
      a handler configured with `basePath: "/trpc/"`; adapter-defined behaviour,
      pinned by no test

## `SteeringFormat.apply` — the checkbox write primitive

The registry gains a second write verb next to `annotate`: turn an anchor plus a
desired state into the edits that set it. This is what lets the phone tick a box
without the server knowing any format.

- [ ] ./src/SteeringFormat.ts#256 — `apply(content, anchor, {checked?, text?})`,
      mandatory on every format, reusing `annotate`'s result union.
      `id-collision` is therefore in the type and unreachable
- [ ] ./src/OpenQuestions.ts#845 — `setOptionCheckedEdits` enforces **radio**:
      `checked: true` ticks the target and unticks every ticked sibling of that
      question
- [ ] ./src/OpenQuestions.ts#874 — `replaceOptionTextEdit` rewrites the option's
      label from the checkbox content offset to end of line
- [ ] ./src/OpenQuestions.ts#903 — `normalizeFreeTextAnswer` collapses
      whitespace so a textarea value spliced onto a `- [x] ` line stays an oxfmt
      fixed point, per the `.gtd/`-is-formatted rule
- [ ] ./src/OpenQuestions.ts#915 — `questionsApply` ticks and replaces the label
      in ONE edit set
- [ ] ./src/ReviewDoc.ts#948 — `reviewApply`: a `hunk` anchor sets one tick, a
      `chunk` anchor sets every hunk beneath it to the caller's exact state —
      explicitly not `toggleChunkEdits`' majority-flip
- [ ] ./src/SteeringFormats.test.ts#79 — asserts every registered format
      declares `apply`. Near-tautological: `apply` is a required member, so TS
      already rejects an entry without it. It catches an `as` cast and nothing
      else

**Silent success is the worst defect in this chunk — four sites return
`{ok: true}` with edits that may be empty or partial.**

- [ ] ./src/OpenQuestions.ts#929 — if `taskItems` finds no item on the option's
      source line, or `replaceOptionTextEdit` hits its wrapped-item guard, the
      tick is applied and **the typed answer is silently dropped** with
      `ok: true`. The phone shows "saved". No test
- [ ] ./src/ReviewDoc.ts#932 — `toggleFilePointer` returning `undefined` on a
      malformed pointer line yields `edits: []`, `ok: true`, and `writeValue`
      writes byte-identical content Either `apply` needs a refusal for "anchor
      resolved but no edit could be built", or `writeValue` should treat an
      empty edit set as a refusal.

**`text` is not gated to the free-text slot.** `questionsApply` never checks
`option.freeText`; free-text-ness is positional (last option), and the HTTP
input validator accepts `text` with any `index`. A client bug or a direct POST
**overwrites a real option's label with the human's prose**, permanently
mangling the steering file. Only the React client's convention keeps this from
happening. No server-side guard, no test.

**Label replacement destroys footnote markers, which can deadlock the loop.**
`replaceOptionTextEdit` replaces content-start to end-of-line, eating any
`[^naXXXX]` marker the UI itself attached to that option. `Footnotes.ts` then
reports "definition has no marker referencing it", the qa mode's `validate:` is
non-empty, and the step refuses. Same family as the known
oxfmt-breaks-the-review-validator deadlock. `stripMarkerText` exists for the
read path; nothing preserves markers on the write path. Untested.

**Empty text breaks the exact invariant `normalizeFreeTextAnswer` protects.**
`normalizeFreeTextAnswer("   ")` returns `""`, which splices to `- [x] ` with a
trailing space — not an oxfmt fixed point, so it reds `format:check` and every
gate that runs the suite. The client guards empty text; the server does not. The
three new tests cover trailing space and interior newline, **not empty**.

**No `apply` test asserts `validate()` round-trips.** Both `annotate` describe
blocks end with `expect(FORMAT.validate(applied)).toEqual([])`; neither `apply`
block does. Since an invalid steering file deadlocks the loop rather than
failing loudly, that is the single highest-value missing line in both new test
blocks.

Also uncovered: `checked: false` with `text` together (documented at
`SteeringFormat.ts#248`); text carrying markdown-active or `[^x]`-shaped
characters, with no escaping anywhere and dictation as the input method; typing
literally `_your answer_`, which parses back to `""` and reads as unanswered
forever; a chunk with zero hunks; CRLF content.

- [ ] ./src/ui/Write.ts#209 — a wrong-kind anchor refuses `anchor-not-found`,
      which renders to the human as "stale, reload the page". `qa` does this for
      a `question` anchor its own `view` emits. A distinct `unsupported-anchor`
      reason would be honest
- [ ] ./src/ReviewDoc.ts#41 — glossary drift, pre-existing but now load-bearing:
      `Changeset` is CONTEXT.md's **Chunk** and `ReviewFile` is its **Hunk**, so
      `reviewApply` reads `changesets[anchor.chunkIndex].files[anchor.index]` —
      glossary term on the anchor, non-glossary term on the data, in one
      expression

## The client opens on the step and writes through to disk

No fleet list, no route back to one, and the two write-through gaps the previous
review confirmed are now closed.

- [ ] ./src/web/App.tsx#25 — `trpc.step.useQuery()` replaces the fleet selection
      state; the served step _is_ the route. `"review"` renders `Review`,
      anything else renders `Plan`, with no third branch
- [ ] ./src/web/screens/Plan.tsx#443 — `casTokensFor` factors the five
      compare-and-swap fields out of three mutation wrappers, with
      `worktreePath` gone from all of them
- [ ] ./src/web/screens/Plan.tsx#479 — `onCommitAnswer` calls
      `setValue.mutateAsync` and invalidates `readSteeringFile`: **question
      answers now reach disk**
- [ ] ./src/web/screens/Question.tsx#221 — the real fix here: focusing the
      textarea used to call `onSelect`, which is now a write. Focus mutates
      local state only; only a radio click writes
- [ ] ./src/web/screens/Question.tsx#263 — `commitFreeText` sends `checked` and
      `text` in one call, and commits nothing for empty or
      placeholder-normalized text — closing two silent-data-loss bugs
- [ ] ./src/web/screens/Review.tsx#463 — `onSetValue`: **hunk ticks now reach
      disk**
- [ ] ./src/web/screens/Review.tsx#145 — `toggleChunk` fans out locally for tap
      responsiveness but ships exactly ONE `setValue` at the chunk anchor,
      reverting the whole map from a captured snapshot on rejection
- [ ] ./src/web/screens/Review.tsx#429 — `HandedBackPanel`, gated on
      `done.isSuccess`, with an explicit note that continuing to render the
      review would let a human tick into a dead server
- [ ] ./src/web/screens/Review.tsx#48 — `worktreePath?: string` becomes
      `live?: boolean`; a boolean-as-mode-switch that only ever takes `true`
      from the one real container

**Every refusal is now invisible.** The `doneRefused` banners are deleted from
both screens, `onDoneNote` swallows every error (`.catch(() => {})` at
`Plan.tsx#497`), and `onSetValue`/`commitAnchor` catch and silently revert. A
`stale-token` on a tick makes the checkbox flick back with **zero explanation**.
This is a regression against the base, which showed one banner.

- [ ] ./src/web/api.ts#33 — `writeRefusalFrom` and `WriteRefusalInfo` survive
      and name exactly those six refusal reasons, but have **no caller in
      `src/web`** — their only consumer was the deleted `drafts.ts`. Wire them
      to a banner, or delete them with their tests

**A blank white screen is the universal failure mode.**

- [ ] ./src/web/App.tsx#28 — `return null` covers query-in-flight, query error,
      dead server and file-less step alike. No spinner, no error surface, no
      `aria-busy`. First paint on a phone over a tailnet is a blank page
- [ ] ./src/web/App.tsx#36 — `mode={step.mode ?? ""}` forwards an empty mode to
      `readSteeringFile` and every mutation; best case a server
      `unsupported-mode` refusal, which per the above displays nothing

**Free text is lost if the textarea is never blurred.** `Question.tsx#118`
commits on blur only, and `NoteSheet.tsx#47` holds note text in plain `useState`
with no autosave at all. Tab close, screen lock, or an unmount without a blur
event discards it — and `drafts.ts`, the local persistence layer, is deleted.
Combined with the `pagehide` finding, one mis-tap on refresh discards in-flight
typing _and_ ends the session.

**An answer cannot be cleared.** `Question.tsx#264` returns early on empty text,
so deleting a previously written free-text answer and blurring leaves the old
text on disk while the UI shows an empty textarea — silent divergence. The guard
is right for a mis-tap and wrong for a deliberate erase, with no gesture
distinguishing them.

**Revert-on-rejection restores a stale snapshot.** `Question.tsx#247` captures
`previous` at call time and `Review.tsx#148` captures a `previous` Map; a slow
rejection restores it wholesale, clobbering anything the human did in the
interim. Tick A, tick B, A's write fails, B's tick vanishes too — realistic on a
flaky tailnet.

**Accessibility.** `HandedBackPanel` is a bare `div` with no
`role="status"`/`aria-live`, so the one state change that matters most is
unannounced. The free-text textarea has a placeholder and no label. Blur-to-
commit has no saving/saved affordance, and on touch, blur is invisible — the
human cannot tell whether the answer landed. And with the `← Fleet` button gone,
**the app has no in-page exit at all**: hand back the turn, or close the tab and
kill the process, neither with a confirmation.

**Story coverage.** New states are largely covered — `Plan.stories.tsx#535`
(option click sends exact tokens), `#587` (refused write reverts), `#631` (focus
and blur with no typing sends zero writes), `#675` (handed-back panel);
`Review.stories.tsx#626` (chunk check-all calls `setValue` exactly once). Gaps:
`Question.stories.tsx` was **not touched at all**, so the whole `onCommitAnswer`
prop is untested at its own layer, and the positive free-text path — type, blur,
one `setValue` carrying `checked` and `text` together — has no story anywhere
despite being package 03's stated acceptance. Also nothing covers the `App`
loading/error branches or the `pagehide` beacon, which is registered at module
top level in `main.tsx` and so is not injectable.

- [ ] ./src/web/Deck.tsx#41 — the "why fallow scores this untested" paragraph
      that used to live once in `Fleet.tsx` is now copied into six files
      (`Deck`, `Mic`, `Plan` ×3, `Review` ×2, `Hunk`, `Question`). One shared
      note became six near-identical ones

## Test doubles split out of `GitDoubles.ts`

Mechanical, one double per file, no behaviour change.

- [ ] ./src/testing/FakeGitOperations.ts#1 — renamed from `GitDoubles.ts`; no
      stale `GitDoubles` reference remains anywhere
- [ ] ./src/testing/StrictGitOperations.ts#13 — `strictGitOperations` moved out
      verbatim: a Proxy where unstubbed methods fail loudly, so there is no
      method list to keep in sync with the port
- [ ] ./src/testing/StrictGitOperations.ts#15 — its `message?` parameter has
      **zero callers**, and the doc comment above cites a `program.test.ts`
      string ("GitService must not be called for --version/--help") that **does
      not exist in the repo**. The extraction was the moment to delete both
- [ ] ./src/GitScript.test.ts#214 — fast-check `numRuns` drops 500 → 100 because
      each run spawns a real bash and 500 timed out under parallel e2e load. A
      flake fix that is also a real coverage loss, and it moves the mutation
      score
- [ ] ./src/ModeContradiction.test.ts#12 — proves a unit test can import
      `applySteeringEdits` from `./ui/Write.js` directly, which makes the two
      new 25-line `applyEdits` copies in `OpenQuestions.test.ts#1714` and
      `ReviewDoc.test.ts#1918` triplicated dead weight

## E2E: a refusal matrix plus a real-process lifecycle suite

`serve.feature` and `serve-loop-lifecycle.feature` are replaced by `ui.feature`
(the refusal matrix) and `ui-lifecycle.feature` (real spawned processes). **Zero
new `Given` steps** — every scenario composes existing generic ones with the
workflow YAML and file bodies inline, which is exactly what AGENTS.md asks for.

- [ ] ./tests/integration/features/ui.feature#16 — the deleted "serve needs no
      repository" scenario, **inverted**: a commitless repo now refuses through
      the shared guard
- [ ] ./tests/integration/features/ui.feature#34 — one scenario per
      non-renderable rest: idle, `message`, `capture`, `script`, `stalled`, and
      a `prompt` whose mode resolves to no format — each exit 2 with no port
      bound
- [ ] ./tests/integration/features/ui-lifecycle.feature#96 — the core new
      behaviour, covered genuinely end to end: a real subprocess, real HTTPS, a
      real `done` mutation, the process observed exiting 0 **unsignalled**, with
      the note on disk
- [ ] ./tests/integration/features/ui-lifecycle.feature#142 — a real `setValue`
      mutation puts `[x] Option A` in `PLAN.md`, exercising
      `SteeringFormat.apply` through the whole stack
- [ ] ./tests/integration/features/ui-lifecycle.feature#193 — `POST /close`
      exits 0 with no note written
- [ ] ./tests/integration/support/world.ts#538 — `spawnBoundGtdUi` factors the
      spawn-and-poll dance out of four helpers;
      `--host 127.0.0.1 --self-signed --port 0` sidesteps both sources of CI
      nondeterminism
- [ ] ./tests/integration/support/setup-files.ts#2 — `ui.steps.ts` moves to
      position 0 with a load-order comment

**A mock that guards nothing, holding a fragile constraint in place.**
`ui.steps.ts` mocks `pickBindHostFromSystem` so the scenarios' "no Tailscale
interface found" assertions stay deterministic — but **no scenario asserts that
any more** (only prose comments mention Tailscale). Both surviving `@inmem`
scenarios fail long before host resolution. The mock forced a silent
module-load-order dependency into `setup-files.ts` that breaks if anyone
reorders that array. Delete it, or add the scenario it exists for.

- [ ] ./tests/integration/support/steps/ui-lifecycle.steps.ts#42 — new
      `the file {string} contains {string}` steps read with raw `readFileSync`,
      duplicating `common.steps.ts#585`'s tier-aware `world.readRepoFile`
      versions. The new ones are silently unusable `@inmem`

**Flake and hygiene risks in the harness.**

- [ ] ./tests/integration/support/world.ts#556 — a 100 × 50ms poll (5s total)
      covers `openssl` certificate generation **plus** a real `gtd next --json`
      subprocess spawn. Tight on a loaded CI box. There is no hard timeout on
      `exited` either, so a process that never exits hangs to the suite timeout
      instead of failing informatively
- [ ] ./tests/integration/support/world.ts#561 — on assertion failure the child
      is **never killed**, orphaning a `gtd ui` holding a socket for the rest of
      the run
- [ ] ./tests/integration/support/world.ts#579 — `NODE_TLS_REJECT_UNAUTHORIZED`
      is mutated on the global `process.env` with a per-call save/restore.
      Interleaved calls clobber each other, and any concurrent test in the same
      worker loses certificate verification for that window. Use a per-request
      agent with `rejectUnauthorized: false`
- [ ] ./tests/integration/support/world.ts#511 — the doc comment says a
      successful bind "blocks forever in-process on success (`Effect.never`)";
      the code now awaits a `Deferred`. Already rotted, in the same range that
      changed it
- [ ] ./tests/integration/support/world.ts#623 — `spawnGtdUiAndSetValue`
      duplicates `spawnGtdUiAndHandOff`'s 20-line token/TLS/client block
      near-verbatim, its own comment admitting it. One `withTrpcClient` helper

**Assertions that would pass while broken.**

- [ ] ./tests/integration/features/ui-lifecycle.feature#97 — the title claims
      "no child process spawned", and nothing in the scenario or the helper
      observes child processes. Assert it or drop the clause
- [ ] ./tests/integration/features/ui.feature#163 — the no-registered-format
      scenario asserts exit 2 with no stderr text, so any unrelated usage error
      passes it green
- [ ] ./tests/integration/features/ui-lifecycle.feature#190 — the `setValue`
      scenario asserts file content but never the exit status, so a `setValue`
      that wrongly terminated the server would pass

**Coverage the deleted features had and nothing replaces at the e2e tier**: the
`--host`-without-a-tailnet refusal, the `--host`-without-a-cert refusal, and
"`--self-signed` does not unlock the `--host` requirement" all moved to
`src/ui/Server.test.ts`, which is a defensible tier choice for network-dependent
assertions. What has no home at all: **`ui.cert`/`ui.key` are exercised by no
scenario anywhere**, the config-key rename has no integration coverage beyond
the negative `ui.loop` case, and nothing covers a `stale-token` refusal, the
`annotate`/note mutation, `--dev`, a successful bind's stdout (URL + QR) as a
user-visible contract, or `GET /` actually returning the client.

## Unrelated: graft agent tooling committed onto this branch

None of this belongs to `serve` → `ui`. It rode along on two step commits and
should come off the branch, or be split out and de-hardcoded.

- [ ] ./.claude/helpers/graft-hooks.cjs#7 — hardcodes
      `BAKED = "/Users/pmelab/.local/share/mise/installs/npm-nanonets-graft/0.16.0/..."`:
      a machine-local absolute path carrying the author's home directory and a
      pinned install, committed to the repo
- [ ] ./.claude/helpers/graft-statusline.cjs#7 — the same hardcoded path in a
      near-identical 98-line file
- [ ] ./.claude/settings.json#48 — adds four graft hooks (SessionStart, two
      PostToolUse, UserPromptSubmit, Stop) plus `statusLine`,
      `subagentStatusLine` and `footerLinksRegexes` to **project** settings, so
      it overrides every contributor's status line and runs graft on their every
      prompt, edit and tool call
- [ ] ./.claude/settings.json#31 — allowlists `Bash(graft:*)`,
      `Bash(npx graft:*)`, `Bash(graft-dev:*)` and `Bash(node dist/cli.js:*)`.
      `graft-dev:*` is a local dev alias, and `node dist/cli.js:*` is broadly
      permissive for a checked-in allowlist
- [ ] ./.mcp.json#1 — registers a `graft` MCP server via a bare `graft` command:
      a broken server entry for every contributor who has not installed it
- [ ] ./.claude/skills/graft/SKILL.md#1 — a vendored 172-line third-party skill
      instructing agents to prefer graft over grep; an unreviewed instruction
      surface for every agent that opens the repo
- [ ] ./.ignore#1 — `!graft/` re-admits the gitignored cards to ripgrep. A neat
      trick, and pointless unless graft is adopted project-wide
- [ ] ./mise.lock#1 — the one defensible file here: a real reproducibility
      improvement alongside the existing `mise.toml`. Still unrelated to this
      branch and belongs in its own commit
