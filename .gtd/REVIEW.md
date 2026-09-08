# Review: b362f0e

<!-- base: 64dd325f2a58a6de056fd6d12472d035bc132194 -->

`gtd serve` — a new HTTPS server plus a React phone/web client that drives the
existing loop from a phone. ~17,700 added lines across four layers: the
CLI/config entry point, a `src/serve/` server, a `src/web/` client, and a
`SteeringFormat` extension that lets any steering mode render and annotate
itself on the phone. Two-bundle build (browser bundle inlined into the node
bundle) and a Storybook browser test tier come along with it.

**Read the three security notes in "Server plumbing and the tRPC surface" and
the two wiring gaps in "Phone client — screens" first. Everything else is
routine.**

## `gtd serve` command, flags, and the `serve:` config key

The CLI entry point. A new `serve` command kind with `--host`/`--port`/
`--self-signed`/`--dev`, a fourth blessed top-level config key `serve:`, and
`needs: "config"` so it runs outside a repository like `visualize` does.

- [ ] ./src/Cli.ts#29 — the `serve` command variant; `host`/`port` stay optional
      rather than defaulted Deliberate: an absent flag must not shadow a
      configured `serve.host`/`serve.port` downstream. Check the comment's claim
      holds against `program.ts#1058`.
- [ ] ./src/Cli.ts#167 — `--port` widened from `visualize`-only to `visualize`
      or `serve` Its error text lost the command name (now bare
      `gtd: --port must be…`). Confirm that reads well for both commands.
- [ ] ./src/Cli.ts#192 — `--host` accepts any non-empty single-line string No
      validation beyond "no newlines". This value flows into a shell command
      (`Tls.ts#48`) and into the bind address. See the security note there.
- [ ] ./src/Cli.ts#490 — the `serve` help row, pinned equal to `docs/cli.md`'s
      `## Commands` block
- [ ] ./src/Cli.ts#1011 — parse branch building the `serve` command
- [ ] ./src/ConfigSchema.ts#219 — `ServeSchema`, the first REAL (non-`Unknown`)
      config sub-schema Six flat optional keys, so `onExcessProperty: "error"`
      rejects unknown sub-keys recursively. The doc comment records a deliberate
      deviation from the package spec: an unknown `serve:` sub-key exits 1 like
      every other config error, not 2. That trade is the one judgment call in
      this chunk.
- [ ] ./src/ConfigSchema.ts#38 — hand-written `serveJsonSchema` overriding the
      derived shape, so `schema.json` stays annotated
- [ ] ./src/Config.ts#319 — new `isOptionalUndefinedArtifact` filter
      `Schema.optional(Struct)` emits a redundant "Expected undefined, actual …"
      issue alongside the real one; this drops it when a more specific issue
      exists at the same-or-deeper path. Worth confirming the path-prefix test
      can't swallow a genuine issue.
- [ ] ./src/program.ts#1058 — `runServeCliCommand`: loads config, hands flags
      plus `config.serve` to `Server.ts`
- [ ] ./src/program.ts#1168 — `standaloneKinds` grows to seven; the comment
      count was updated with it
- [ ] ./src/Cli.test.ts#752 — parse coverage for the new flags, scope errors,
      and `serve extra` as a usage error
- [ ] ./src/ConfigSchema.test.ts#126 — `serve:` decode coverage, including the
      excess-sub-key rejection
- [ ] ./src/Config.test.ts#209 — `serve:` merges low→high across config layers,
      cwd winning per key
- [ ] ./src/program.test.ts#2332 — `serve` dispatches without the
      repo-root/commit guard
- [ ] ./src/program.test.ts#23 — `pickBindHostFromSystem` mocked so a real
      tailnet on the dev machine can't red these tests

## Server plumbing and the tRPC surface

The HTTPS listener, bind-host and TLS resolution, the tRPC router, worktree
discovery, and the `gtd` shim. This is where the security model lives, and it is
one line deep: the whole surface is unauthenticated and mitigated only by
refusing to bind outside a tailnet.

- [ ] ./src/serve/Router.ts#262 — `runCommand` runs the client's string VERBATIM
      through `CommandRunner.bash` Unauthenticated remote arbitrary shell
      execution on the host. The doc comment above it states this as accepted
      design. It is the single highest-risk line in the branch — confirm you
      accept it, because nothing downstream constrains it.
- [ ] ./src/serve/Server.ts#62 — `resolveBindHost` accepts ANY
      `--host`/`serve.host` with no validation The tailnet refusal is the entire
      mitigation for the line above, and it is bypassed by `--host 0.0.0.0`,
      which puts arbitrary shell execution on the LAN. There is also no auth, no
      Origin check, and no CSRF token, so any page a browser on that network
      loads can POST to `/trpc/runCommand`. An explicit reject of `0.0.0.0`/`::`
      or a bearer token in the QR URL would close this.
- [ ] ./src/serve/Tls.ts#48 — `request.host` is interpolated into an `openssl`
      command string Shell-injection sink reachable from `--host` or a
      checked-in `serve.host` (`--host '$(...)'`). Repo-controlled once it is in
      config.
- [ ] ./src/serve/Tls.ts#43 — the temp dir holding the generated PRIVATE KEY
      leaks on both failure paths `mkdtempSync` here, `rmSync` only at line 88;
      the non-zero-exit return (67) and the unreadable-output return (80) both
      bypass it, leaving a key in `$TMPDIR`.
- [ ] ./src/serve/Bind.ts#8 — Tailscale detection is a numeric `100.64.0.0/10`
      octet test, no `tailscale` binary Any other process holding a CGNAT
      address (another VPN, some carrier ranges) is treated as "the tailnet".
- [ ] ./src/serve/Bind.ts#36 — dead branch: `name < best.name` can never be true
      after `Object.keys().sort()` Behavior is "first sorted interface wins",
      which matches the doc comment; the last two comparator clauses are
      unreachable.
- [ ] ./src/serve/Server.ts#342 — the entire routing surface is `/trpc` vs
      everything-else-is-HTML No path normalization anywhere in the process.
- [ ] ./src/serve/Server.ts#229 — `--dev` runs `npx tsdown --filter web` PER
      REQUEST No debounce and no lock, so concurrent requests race the same
      `dist/web/main.js`. Development-only by design.
- [ ] ./src/serve/Discover.ts#47 — a `.git` directory is recorded AND still
      descended into Depth-4 serial walk, no memoization, re-run on every fleet
      poll — the fleet endpoint's latency scales with tree size. Deliberate
      asymmetry against the process-lifetime `BeatCache`; confirm you want it.
- [ ] ./src/serve/Discover.ts#20 — 12 hex chars (48 bits) of SHA-256 as the
      public worktree id
- [ ] ./src/serve/Shim.ts#34 — `exec <quoted argv> "$@"`, argv never re-joined
      into one string This is what keeps `gtd check <mode> '<file>'` safe. Note
      line 78: shim temp dirs are created per spawn and never removed.
- [ ] ./src/serve/Registry.ts#104 — `reserve` installs a placeholder whose
      `wait` never resolves Safe only because `Loop.ts#193` releases on every
      throw path (verified). A future caller between `reserve` and `replace`
      that throws elsewhere pins that worktree to Working for the life of the
      process.
- [ ] ./src/serve/Registry.ts#152 — the 30s mtime "possibly driven elsewhere"
      heuristic Deliberately imprecise. Check the UI labels it as such —
      `Fleet.tsx#71` lets it win over `interrupted`, so an interrupted row can
      be mislabeled.
- [ ] ./src/serve/View.ts#31 — the one mode→`view()` dispatch, so the server
      never imports a format module A throwing custom format surfaces as an
      untyped 500, not a typed refusal.
- [ ] ./src/serve/Qr.ts#10 — relies on `qrcode-terminal.generate`'s callback
      being synchronous Returns `""` silently if that ever changes; no throw on
      empty.
- [ ] ./src/serve/scriptTag.mjs#20 — the replacement must be a FUNCTION, not a
      string React's `$&` in the bundle would otherwise expand and emit a
      script-terminating `</script>`. `SCRIPT_TAG_PATTERN` (line 6) is an exact
      literal match, but `scripts/inline-web-client.mjs` throws when it stops
      matching and `Server.test.ts#342` asserts no `src="./main.js"` survives,
      so the coupling fails loudly rather than silently.
- [ ] ./src/serve/Server.test.ts#322 — the `--dev` inline path, including that
      assertion
- [ ] ./src/serve/Router.test.ts#1 — router coverage: input validators, the five
      refusal classes, the `errorFormatter` lift into `error.data.*`

## Beat reading, the loop child, and per-worktree data access

The domain layer behind the tRPC endpoints: read a worktree's beat (cached),
spawn and signal the configured `serve.loop` child, bucket the fleet, parse
diffs into hunks, and write a note back under compare-and-swap.

- [ ] ./src/serve/Beat.ts#22 — `findOwnVersion` THROWS AT MODULE IMPORT when no
      `@pmelab/gtd` manifest is found within 8 parent dirs Any packaging change
      that moves the bundle further from its manifest, or a consumer vendoring
      the bundle alone, is not a degraded version check — it is `gtd serve`
      failing to import at all. A `?? "0.0.0"` fallback is strictly safer.
- [ ] ./src/serve/Beat.ts#448 — `withSlot`'s direct slot handoff, never
      decrement-then-resume Fixes a concurrency overshoot the comment describes.
      The invariant: `queue.shift()` inside `finally` must be the only place
      `active` decreases. It is today.
- [ ] ./src/serve/Beat.ts#463 — `read`'s cache key is HEAD sha + steering
      mtime + loop-log mtime; broken rows are never memoized The warm path
      re-stats the CACHED `filePath`/`logPath`, not freshly reported ones. A
      steering file swapped to a different path with no commit and no mtime
      change on the old path serves stale forever. Narrow; worth a conscious
      ack.
- [ ] ./src/serve/Beat.ts#121 — `liveRunInWorktree` prepends
      `<cwd>/node_modules/.bin` to `$PATH` and runs `bash -c` with the worktree
      as cwd `maxBuffer` is 16MB; an over-limit beat is reported as
      `spawnError`, i.e. as "never ran" — misleading but not harmful.
- [ ] ./src/serve/Loop.ts#50 — `detached: true` plus signalling `-pid` (the
      whole process group) The core correctness decision: without it the forked
      agent per turn survives both SIGINT and SIGKILL. But there is no
      `child.unref()` and nothing kills registry children when `gtd serve`
      itself exits — a server shutdown leaves live loops running.
- [ ] ./src/serve/Loop.ts#83 — child stdout/stderr accumulate into unbounded
      strings for the child's whole lifetime No cap, unlike `Beat.ts`'s 16MB
      `maxBuffer`. A chatty loop command is a server-side memory leak.
- [ ] ./src/serve/Loop.ts#185 — `startLoop`'s `reserve`/`replace`/`release`
      closes the check-then-register race across the shim-creation `await` It
      RETHROWS on shim/spawn failure rather than returning `{ok:false}`, so
      those surface as tRPC errors while `already-driving` is a named refusal.
      Asymmetric.
- [ ] ./src/serve/Diff.ts#162 — `base` is interpolated RAW into `bash -c` while
      `path` right beside it is properly quoted `base` is `gtd base`'s stdout,
      unvalidated here. Git permits a fair amount in ref names, so this is
      command injection that needs only influence over `gtd base`'s output, not
      access to the server. Quote it the same way, or assert a charset.
- [ ] ./src/serve/Diff.ts#111 — `hunkContainsLine` with `newLines === 0` (a pure
      deletion) matches no line, ever Documented as a fixed bug; the subtlest
      invariant here and the one most likely to be re-broken.
- [ ] ./src/serve/Diff.ts#175 — binary detection needs BOTH the anchored
      `Binary files … differ` line and zero parsed hunks Zero-hunk-non-binary
      gets its own `no-changes` kind rather than `whole-file`. Both guards exist
      so the phone never shows a banner over an empty body.
- [ ] ./src/serve/Write.ts#124 — `join(worktreePath, filePath)` on fully
      client-controlled strings, then READ AND WRITTEN `Router.ts`'s
      `writeNoteInput` only checks both are non-empty strings: no `..`
      rejection, no confinement to what `Discover.ts` actually found. Same for
      the `bash -c` cwd in `Beat.ts#121`, `Diff.ts`, and `Loop.ts#78`. Confining
      `worktreePath` to the discovered set is a few lines and removes the
      sharpest edge of the "no auth, tailnet-only" stance.
- [ ] ./src/serve/Write.ts#100 — `writeQueues` serializes writes per path so
      exactly one racer wins Correct; the loser re-reads the winner's write and
      refuses as stale. The `Map` is never pruned — one entry per absolute path,
      for the server's life.
- [ ] ./src/serve/Write.ts#127 — the resting-actor gate runs BEFORE the token
      comparison, and `liveActorAt` spawns a fresh `gtd next --json` per write
      Every write pays the ~500ms bundle parse, and a transient spawn failure
      reads as `not-resting` — reported to the user as a state refusal rather
      than an error.
- [ ] ./src/serve/ReadSteeringFile.ts#57 — a missing HEAD becomes `""` here but
      `undefined` in `Write.ts#132` So `undefined !== ""` refuses as
      `stale-token` FOREVER, not transiently: a commit-less worktree is
      permanently unwritable. The comment at line 33 waves this off as "a
      normal, already-handled refusal". Pick one sentinel on both sides.
- [ ] ./src/serve/Fleet.ts#32 — `bucketOf`'s precedence IS the fleet policy:
      driving beats everything, then broken, stalled, interrupted,
      `!idle && human`, idle Read it against the spec; reordering is silent.
- [ ] ./src/serve/Fleet.ts#60 — compares `Date.parse` instants, not ISO strings,
      because `%cI` carries a committer offset Right call. A malformed `rest`
      yields `NaN` and an implementation-defined sort; `restOf` guards `broken`
      but not a garbage `rest`.
- [ ] ./src/serve/Fleet.ts#135 — `readFleet` fans out with `Promise.all` and no
      limit; the only backpressure is `BeatCache`'s own concurrency
- [ ] ./src/serve/Beat.test.ts#1 — 696 lines covering the cache key, slot
      handoff, and row projection
- [ ] ./src/serve/Write.test.ts#1 — compare-and-swap refusals and the per-path
      write serialization

## Phone client — shared components

The format-agnostic pieces: app shell, list rows, the deck pager, Web Speech
dictation, the note sheet, diff tokenizing, the tRPC client, and offline drafts.

- [ ] ./src/web/drafts.ts#1 — THIS WHOLE MODULE IS UNREACHABLE
      `saveDraft`/`loadDraft`/`discardDraft`/`shouldApplyBackgroundRefresh`/
      `localStorageDraftStorage` have zero importers outside `drafts.test.ts`
      (verified by grep). `npx fallow` reports clean because its own test counts
      as an entry point, so the dead-code gate does not catch this. The
      offline-draft behavior is specified and unit-tested in isolation but never
      wired: no screen persists a refused write's text, and no screen consults
      `shouldApplyBackgroundRefresh` before letting a refetch swap content in.
      Either wire it or drop it.
- [ ] ./src/web/drafts.ts#39 — the key is `worktreeId:filePath`, but there is no
      caller to say whether a path or `Fleet`'s `row.id` is meant
- [ ] ./src/web/drafts.ts#43 — `bannerFor`'s exhaustive `switch` has no
      `default`, so an unknown reason from `api.ts` yields `undefined`
- [ ] ./src/web/api.ts#33 — `writeRefusalFrom`/`driveRefusalFrom` duck-type
      `error.data.*` off the wire Lines 46 and 48 cast any string through as a
      valid `reason`. The shapes are deliberately NOT imported from
      `serve/Router.ts`; the drift risk is accepted by comment. Combined with
      the `bannerFor` note above, an unknown reason renders blank.
- [ ] ./src/web/Mic.tsx#88 — `recognitionRef` is never stopped on unmount
      Navigating away mid-dictation leaves recognition running and `onAttach`
      firing into an unmounted tree.
- [ ] ./src/web/Mic.tsx#93 — feature detection runs in `useEffect`, so
      `available` is false on first paint and the keyboard-mic hint flashes
- [ ] ./src/web/Mic.tsx#119 — `erroredRef` gates the write-through;
      `not-allowed` sets `available = false` with no recovery once permission is
      granted
- [ ] ./src/web/NoteSheet.tsx#74 — keyboard avoidance rests entirely on flow
      layout, `100dvh`, and `interactive-widget=resizes-content`
      (./src/web/index.html#13) The comment admits this is untestable in jsdom,
      and `interactive-widget` support is not universal. Real-device
      verification is the reviewer's job.
- [ ] ./src/web/NoteSheet.tsx#47 — `useState(note ?? "")` initializes once, so a
      background refetch leaves the textarea holding stale text
- [ ] ./src/web/Deck.tsx#50 — advancing past the last item calls `onExit`, so
      "Done" is purely an exit and saves nothing
- [ ] ./src/web/Deck.tsx#59 — `items.length === 0` renders `null`: no content,
      no Back `Review.tsx#400` guards against entering the deck empty;
      `Plan.tsx#364` does not.
- [ ] ./src/web/Deck.tsx#46 — mixed controlled/uncontrolled index; passing
      `index` without `onIndexChange` silently freezes the deck
- [ ] ./src/web/App.tsx#21 — navigation is plain `useState`, no history or URL
      Browser Back leaves the app instead of returning to the fleet, and a
      reload drops the selected worktree.
- [ ] ./src/web/App.tsx#52 — the one CLIENT-side switch on `mode` The comment
      argues why this does not violate the server's "never switch on mode name"
      rule. Confirm you agree with that reading.
- [ ] ./src/web/Highlight.ts#23 — module-level `RegExp` whose `lastIndex` is
      mutated in `tokenize` Safe single-threaded, not reentrant. Consumers
      render text nodes, so React escapes the output.
- [ ] ./src/web/Card.tsx#22 — `borderBottom` shorthand, then three longhand
      overrides, then `border: "none"` — redundant and fragile
- [ ] ./src/web/useScrollRestoration.ts#20 — a single `requestAnimationFrame`;
      one frame may be too early if the restored list renders asynchronously
- [ ] ./src/web/testing/TrpcTestProvider.tsx#21 — a mock terminating tRPC link,
      so stories exercise the REAL containers A thrown resolver becomes a real
      `observer.error`, so `mutateAsync` rejects like production. Note line 67:
      `resolveFleet` is merged as `{fleet, ...resolvers}`, so a
      `resolvers.fleet` entry silently wins over the dedicated prop.
- [ ] ./src/web/main.tsx#13 — silently does nothing when `#root` is missing
- [ ] ./src/web/tsconfig.json#1 — DOM libs for this directory only;
      `"exclude": []` deliberately overrides the base config's
      `exclude: ["src/web"]`

## Phone client — screens

The five mode-shaped screens. Two of them do not persist their primary gesture,
which is the biggest functional gap in the branch.

- [ ] ./src/web/screens/Plan.tsx#310 — QUESTION ANSWERS ARE NEVER WRITTEN TO THE
      SERVER `answers` lives in React state and nothing in `Plan`/`PlanView`
      ever passes it to `writeNote` or `done` — `onSaveNote`/`onDoneNote` only
      ever fire from `NoteSheet` for paragraph anchors. Every radio tick and
      every typed or dictated answer is lost on unmount or reload. The map is
      also keyed by DECK INDEX, not by anchor, so a refetch that reorders nodes
      re-keys answers onto the wrong question.
- [ ] ./src/web/screens/Review.tsx#137 — hunk ticks and check-all are LOCAL ONLY
      Documented as deliberate, but nothing warns the user their approvals are
      not persisted. With the answers gap above, neither screen's primary
      gesture survives a reload.
- [ ] ./src/web/screens/Plan.tsx#445 — `readSteeringFile` is invalidated on
      every `onSettled`, unconditionally Same at
      ./src/web/screens/Review.tsx#437. A background refresh can replace content
      under an open editor — exactly what `drafts.ts#100`'s unwired
      `shouldApplyBackgroundRefresh` was written to prevent.
- [ ] ./src/web/screens/Plan.tsx#22 — `usePlanReadConfirmation` touches
      `localStorage` DIRECTLY in a `useState` initializer Bypasses `drafts.ts`'s
      injected `DraftStorage` pattern and throws outright in blocked-storage
      contexts (Safari private mode). The `useEffect` below re-reads on
      `contentHash` change anyway, so the initializer is redundant.
- [ ] ./src/web/screens/Plan.tsx#364 — enters the question deck without checking
      `openQuestionNodesOf(view).length > 0` An empty list hits `Deck.tsx#59`'s
      `null` — a dead-end screen with no Back. `Review.tsx#400` has exactly this
      guard; `Plan` lacks it.
- [ ] ./src/web/screens/Plan.tsx#331 — optimistic `noteOverrides` revert on
      rejection, but only for `paragraph` anchors and silently No banner, no
      draft saved. `onDoneNote`'s catch swallows every non-drive refusal.
- [ ] ./src/web/screens/Plan.tsx#228 — `allNodes.indexOf(node)` per card: O(n²)
      and identity-dependent
- [ ] ./src/web/screens/Review.tsx#24 — `hunkKey`/`noteKey` return `""` for
      unexpected anchor kinds Any non-hunk/chunk anchor collides into one shared
      `""` bucket in `ticked`/`notes`.
- [ ] ./src/web/screens/Review.tsx#155 — `deckIndex` resets on `openChunk` but
      NOT when `view` changes underneath A refetch that shrinks a chunk leaves
      `deckIndex` past the end, so `Deck.tsx#60` renders `undefined`: blank
      content with working controls.
- [ ] ./src/web/screens/Review.tsx#198 — `HunkWithDiff` mounts only for the
      current deck item, one `trpc.diff` query per screen `query.error` is
      discarded, so an errored diff is indistinguishable from loading.
- [ ] ./src/web/screens/Hunk.tsx#87 — the six-way diff branch;
      `diff === undefined` is a PERMANENT "Loading diff…" No error and no
      timeout state, because the error above is dropped.
- [ ] ./src/web/screens/Hunk.tsx#158 — ticking the checkbox calls `onApprove`,
      which ADVANCES the deck So ticking the last hunk exits the whole deck. A
      mis-tap navigates away with no undo.
- [ ] ./src/web/screens/Hunk.tsx#53 — diff lines keyed by array index,
      per-container `overflowX: auto`, no line numbers
- [ ] ./src/web/screens/Question.tsx#62 — `onAnswerChange` takes a FUNCTIONAL
      updater specifically so `Mic`'s `onAttach` cannot clobber text typed
      during a live dictation session The subtlest correctness argument in the
      diff. Verify the stories actually cover type-during-dictation.
- [ ] ./src/web/screens/Question.tsx#26 — `singleCheckedIndex`: both 0 and ≥2
      ticked seed `undefined`, deliberately never "pick the first" The free-text
      slot is identified by array POSITION (`options.length - 1`), never by
      label.
- [ ] ./src/web/screens/Question.tsx#160 — radio `name` is
      `question-${node.title}`, so two questions with identical titles share a
      group Safe only because the deck renders one at a time.
- [ ] ./src/web/screens/Question.tsx#225 — reuses the server's exported
      `isAnswered` rather than a local rule; status is display-only and gates
      nothing
- [ ] ./src/web/screens/Fleet.tsx#288 — pull-to-refresh is TOUCH-ONLY, with no
      button On desktop or keyboard the only path to fresh data is the 5s poll
      (line 388). `onTouchMove` also calls `setPull` per move event (a re-render
      per frame) and never `preventDefault`s, so it fights native overscroll.
- [ ] ./src/web/screens/Fleet.tsx#123 — `row.file!` / `row.mode!` non-null
      assertions whose guard lives in a DIFFERENT component (`FleetRowMain`,
      line 190) Any future caller of `FleetRowOpenButton` breaks this silently.
- [ ] ./src/web/screens/Fleet.tsx#349 — mutates `document.title` with the
      wants-you count A global side effect from a presentational component,
      never reset on unmount.
- [ ] ./src/web/screens/Fleet.tsx#398 — `stop` refetches `onSettled` with no
      error surface if it fails
- [ ] ./src/web/screens/Review.stories.tsx#418 — stories drive the REAL
      containers through the mock tRPC link, asserting exact CAS tokens Same
      pattern in ./src/web/screens/Plan.stories.tsx#386. These are the branch's
      integration coverage for the client; they are also the only place the
      containers are exercised at all.
- [ ] ./src/web/screens/Fleet.stories.tsx#1 — bucket ordering and dirty-reason
      labels
- [ ] ./src/web/screens/Question.stories.tsx#1 — radio/free-text/dictation
      states
- [ ] ./src/web/screens/Hunk.stories.tsx#1 — the six diff branches
- [ ] ./src/web/NoteSheet.test.ts#1 — the only non-story unit coverage for a
      component

## `SteeringFormat` grows `view` and `annotate`

The seam that lets the server render and annotate any steering mode without
importing a format module or switching on the mode name: two new MANDATORY port
members, a format-agnostic anchor vocabulary, and a shared footnote-attachment
primitive. Both built-ins implement the pair.

- [ ] ./src/SteeringFormat.ts#219 — `view` and `annotate` are mandatory, not
      optional like `pointerAt`/`documentLinks` A breaking change for any
      out-of-tree `SteeringFormat` implementer.
- [ ] ./src/SteeringFormat.ts#99 — `SteeringAnchor` is a CLOSED union
      (chunk/hunk/question/option/paragraph) A third format must reuse the
      chunk/hunk naming or add a member, which undercuts the "a custom mode
      lights up the phone UI for free" claim this same file makes at line 211.
- [ ] ./src/SteeringFormat.ts#132 — `SteeringViewNode` has nothing type-level
      distinguishing a container from an item; only `children` presence does
- [ ] ./src/Footnotes.ts#312 — `anchorId`: 32-bit FNV-1a rendered as
      `na<base36>` Collisions are possible and surface as a user-visible
      `id-collision` refusal. No wider id space, no retry.
- [ ] ./src/Footnotes.ts#366 — the same-anchor EDIT-IN-PLACE path, a genuine
      behavior change Detection needs a marker with the same folded id ON
      `anchor.line`. But anchor keys are line-derived (`chunk:${headingLine}`),
      so any edit ABOVE the anchor shifts the line, yields a new key, a new id,
      and therefore a SECOND note rather than an edit. The edit-in-place
      guarantee holds only while lines do not move.
- [ ] ./src/Footnotes.ts#396 — `\r\n` preservation exists only in the two-edit
      path The update path at line 385 rewrites `[^id]: text` as one line,
      collapsing a previously reflowed multi-line definition each time.
- [ ] ./src/ReviewDoc.ts#796 — BUG: `definitionByName.get(marker.name)` with no
      `foldName` The map is keyed by raw `d.name` (line 804) but footnote names
      match case-insensitively everywhere else (`Footnotes.ts#53`). So
      `## Chunk[^Foo]` plus `[^foo]: note` validates clean, yet `view()` returns
      `note: undefined` — the UI shows "no note" and then attaches a second one.
      Same defect at ./src/OpenQuestions.ts#968. Inherited from the pre-existing
      `footnoteLeaf` (line 533), but propagated into new code.
- [ ] ./src/ReviewDoc.ts#771 — orphaned duplicate JSDoc: `reviewView`'s doc
      block sits above `chunkNoteOf`'s own So `chunkNoteOf` has two doc comments
      and `reviewView` (line 801) has none. Clear editing artifact.
- [ ] ./src/ReviewDoc.ts#888 — `resolveReviewAnchor` resolves index anchors
      POSITIONALLY with no content check A stale-but-in-range index annotates
      the WRONG chunk or hunk. The doc comment's claim that "a stale anchor is
      REJECTED rather than silently attaching to the wrong node" holds only for
      out-of-range indices. Same at ./src/OpenQuestions.ts#1082.
- [ ] ./src/OpenQuestions.ts#302 — `AnsweredOption` and `isAnswered` become
      public, the single source of truth `Question.tsx` reuses New public
      surface; previously private. Placeholder comparison now folds both sides.
- [ ] ./src/OpenQuestions.ts#910 — `isProseOnly` and
      `questionsSectionHeadingIndex` duplicate the same heading predicate in two
      walks `isProseOnly` is exactly
      `questionsSectionHeadingIndex(...) === undefined`.
- [ ] ./src/OpenQuestions.ts#1061 — `resolveQuestionsParagraphAnchor` is
      byte-identical to `ReviewDoc`'s `resolveParagraphAnchor` Duplicated rather
      than lifted into `Footnotes.ts` alongside the other shared footnote
      machinery.
- [ ] ./src/OpenQuestions.ts#390 — two `checkSectionOrder` clause
      simplifications, verified logically equivalent (mutation-kill cleanups,
      not behavior)
- [ ] ./src/CommandRunner.ts#9 — `stdout`/`stderr` added to `CommandOutcome` as
      OPTIONAL purely so existing test doubles still typecheck Production always
      sets them (line 68), so every real consumer needs a `??`. Making them
      required and fixing the doubles would be stricter. Note `output` is now
      redundantly derivable from the two — two representations of the same bytes
      that can drift.
- [ ] ./src/Commentary.ts#39 — "three families" → "four", adding `serve/Tls.ts`
      Hand-maintained prose with no test pinning it; stale on the next
      `GtdError` site.
- [ ] ./src/testing/Layers.ts#321 — a LOUDLY-FAILING `HttpsServer` double, so a
      reaching call is a visible test gap rather than silence Couples the shared
      test layer to the `src/serve/` subtree.
- [ ] ./src/SteeringFormats.test.ts#130 — registry-driven property: every anchor
      `view` reports must be one `annotate` accepts It accepts `id-collision` as
      a pass, so a format whose anchors ALL collide would still go green; only
      `anchor-not-found` fails.
- [ ] ./src/SteeringFormats.test.ts#286 — the qa cursor fixture is now derived
      from `sample` instead of hardcoded, which is what unblocked adding a
      second sample footnote
- [ ] ./src/ModeContradiction.test.ts#214 — `LONG_UNWRAPPED_NOTE`, the
      real-oxfmt reflow fixture Attaches a deliberately unwrapped long note with
      a multi-word code span and asserts oxfmt actually rewrapped it
      (`endLine > line`) and the doc still validates. This is the test that
      would have caught the known "oxfmt reflows a server-written note into an
      invalid doc" failure.
- [ ] ./src/ModeContradiction.test.ts#194 — `attachAtFirstFreeAnchor`'s own
      comment admits its `throw` is now dead, since same-anchor is an edit
- [ ] ./src/ModeContradiction.test.ts#256 — spawns real `bash` with a stub `gtd`
      on `$PATH` and inherits `process.env` Environment-dependent and slower
      (~1.2s) than the rest of the unit tier.
- [ ] ./src/OpenQuestions.test.ts#1596 — `getParseCount()` assertions pin "one
      parse per `view`" Memo-sensitive: they need a unique content string per
      test and will red on any caching change. Same at
      ./src/ReviewDoc.test.ts#1815.
- [ ] ./src/Footnotes.test.ts#466 — the collision test builds its colliding id
      by upper-casing a generated one It pins the fold-INSENSITIVE collision
      path, yet no test covers a case-mismatched marker/definition in `view` —
      exactly where the `ReviewDoc.ts#796` bug hides.
- [ ] ./src/OpenQuestions.test.ts#1690 — the offset-sort edit-applying helper is
      inlined a fourth time here Also at ./src/ReviewDoc.test.ts#1867 and
      ./src/Footnotes.test.ts#12, while `serve/Write.ts`'s `applySteeringEdits`
      already exists and is what `ModeContradiction.test.ts` uses.

## Two-bundle build and the Storybook test tier

The build becomes browser-first: a browser bundle, an inline step folding it
into one gitignored HTML file, then the node bundle importing that HTML as a
string. A fourth vitest project runs every story in a real headless Chromium.

- [ ] ./tsdown.config.ts#10 — one config becomes an array of two, `web` then
      `gtd` tsdown builds array entries IN PARALLEL, so the ordering is not
      self-enforcing — `package.json`'s `build` script runs three sequential
      steps and selects each config by `name`. That coupling is the fragile
      part.
- [ ] ./tsdown.config.ts#51 — `qrcode-terminal` is the ONE package kept external
      Its vendored `lib/main.js` uses legacy octal escapes that rolldown's
      strict-mode parser rejects. It is already a runtime `dependencies` entry,
      so `npm install` still provides it — chosen over patching a dependency's
      source.
- [ ] ./scripts/inline-web-client.mjs#12 — THROWS when `src/web/index.html` no
      longer carries the expected script tag This is what turns the
      exact-literal `SCRIPT_TAG_PATTERN` coupling into a build failure instead
      of a silently un-inlined page.
- [ ] ./package.json#32 — `build` is now three sequential commands, and
      `typecheck` is two `tsc` runs The second run uses `src/web/tsconfig.json`,
      since ./tsconfig.json#22 now EXCLUDES `src/web`.
- [ ] ./package.json#49 — `test:web` joins the turbo task list; `storybook`
      binds `--host 0.0.0.0`
- [ ] ./package.json#106 — `@trpc/server` and `qrcode-terminal` are the only new
      RUNTIME dependencies React, `@trpc/client`, `@trpc/react-query`, and
      `@tanstack/react-query` stay devDependencies because they are inlined at
      build time.
- [ ] ./vitest.config.ts#84 — the new `storybook` project: `@vitest/browser` +
      Playwright Chromium, headless Vitest already brings vite, so no second
      bundler enters the repo.
- [ ] ./tests/vitest.ensureWebClient.ts#28 — a vite `resolveId` hook that BUILDS
      the missing `generated.html` on demand, once Covers the two sanctioned
      entry points that bypass turbo (`test:mutation`, a bare
      `test:unit`/`test:changed`), because a `pre<task>` npm script is banned
      outright. It shells out to `npx tsdown` from inside a test run — check you
      accept that.
- [ ] ./turbo.json#46 — `test:unit` and `test:e2e:inmem` gain
      `dependsOn: ["build"]` Because `Server.ts` imports the generated HTML.
      Test runtime now includes a build.
- [ ] ./turbo.json#83 — `test:web` declares `src/**` and `.storybook/**`, minus
      `!src/web/generated.html` `src/web/**` alone would under-declare: the
      screens value-import from `src/OpenQuestions.ts`, `src/serve/Diff.ts`,
      `src/serve/Fleet.ts`, and `src/SteeringFormat.ts`.
- [ ] ./tests/tooling/turbo.test.ts#59 — three new cache-correctness tests
      pinning exactly those inputs
- [ ] ./tests/tooling/turbo.test.ts#96 — pins React and friends OUT of
      `dependencies`, `@trpc/server` IN So `npm i -g @pmelab/gtd` never pulls
      React.
- [ ] ./.fallowrc.json#5 — `src/web/main.tsx` declared as a second bundle root;
      React and friends added to `ignoreDependencies` Note the `.storybook`
      comment: fallow's built-in storybook plugin already discovers stories, so
      no manual entry. Verify with `npx fallow list` if plugin detection changes
      upstream. Worth knowing: `fallow` reports clean on this branch even though
      `src/web/drafts.ts` is unreachable, because its own test counts as an
      entry point.
- [ ] ./.oxlintrc.json#3 — the `react` plugin, `rules-of-hooks` as error,
      `exhaustive-deps` as WARN A warn-level `exhaustive-deps` does not fail
      `npm run lint`.
- [ ] ./.oxlintrc.json#37 — `*.stories.tsx` gets the same
      `no-restricted-imports` carve-out `src/testing/**` has
- [ ] ./.github/workflows/test.yml#25 — CI installs Playwright Chromium with
      `--with-deps` New CI dependency and install time for the `test:web` tier.
- [ ] ./.storybook/main.ts#1 — the Storybook config: story glob plus the vitest
      addon
- [ ] ./.gitignore#53 — `src/web/generated.html` ignored, mirroring
      `schema.json`
- [ ] ./package-lock.json#1 — 2,094 added lines: React, Storybook, Playwright,
      tRPC, TanStack Query, `qrcode-terminal` Mechanical; skim the top-level
      `dependencies` block only.

## `gtd serve` process-lifecycle tests and docs

Two feature files split by what each tier can actually reach, plus the doc
updates. `serve.feature` covers only refusal paths because a successful bind
blocks forever in-process; a `@live` file spawns a real `gtd serve` to prove it
binds and dies cleanly.

- [ ] ./tests/integration/features/serve.feature#1 — four `@inmem` refusal
      scenarios, and the header explains why there is no success case here Two
      of them pin that both refusals name BOTH remedies, and one pins that a
      commit-less repo reaches serve's own refusal rather than a repo guard.
- [ ] ./tests/integration/features/serve-loop-lifecycle.feature#25 —
      real-process SIGINT/SIGTERM, asserting exit 130 and 143 The header argues
      at length that the `done`/`stop` tRPC round trip belongs at the
      `Server.test.ts` unit tier instead. Judge whether you agree that no
      cucumber scenario should cover it.
- [ ] ./tests/integration/support/world.ts#522 — `spawnGtdServeAndSignal`: binds
      with `--host 127.0.0.1 --self-signed --port 0` Needs no tailnet and no
      fixed port. POLLS stdout for `https://` (up to 5s) rather than a fixed
      delay, because certificate generation spawns its own openssl subprocess.
- [ ] ./tests/integration/support/steps/serve.steps.ts#14 —
      `pickBindHostFromSystem` mocked to `undefined` for the WHOLE `e2e-inmem`
      project Otherwise a dev machine or CI runner on a tailnet reds the "no
      Tailscale interface found" assertions. It cannot reach the `e2e-live`
      tier, which spawns a real process.
- [ ] ./tests/tooling/support/run-in-pty.py#40 — pty drain timeout raised 0.05s
      → 0.5s Unrelated flake fix: under `npm test`'s concurrent load, the
      child's `write()` can lag the scheduler noticing it exited, and the short
      timeout read that gap as "no more data". Never reproduced standalone.
- [ ] ./docs/cli.md#77 — the `serve` command row and its four flags, pinned
      equal to rendered help output
- [ ] ./docs/configuration.md#52 — the new `## The serve: key` section
      documenting all six settings It also documents the `serve.loop` contract
      in full: worktree cwd, shim `$PATH`, exit code and output ignored for
      control flow but shown on the fleet row, SIGINT-then-SIGKILL-after-5s, and
      unlimited concurrency across worktrees.
- [ ] ./docs/driver.md#202 — a new "Being spawned by `gtd serve`" section
      stating the same contract from the driver's side Deliberate duplication
      across two docs. Confirm you want both, since they will drift.
- [ ] ./README.md#1 — NOT TOUCHED, and neither was ./docs/README.md or
      ./CONTEXT.md The repo's own rule is that every significant change is
      reflected in the README. A whole new command and a whole new UI surface
      landed with no README mention, and `CONTEXT.md`'s glossary gained no entry
      for the new domain words this branch introduces — beat, fleet, row bucket,
      hunk deck, anchor, annotate. Decide whether the two indexed docs are
      enough.
