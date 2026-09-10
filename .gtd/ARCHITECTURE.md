Four concerns, four packages, no merges. One is server/network work inside
`src/ui/`; three are the phone UI, and they build on each other in the order
below — the view-shape change first, because the two after it write their
stories against the shape it produces.

### 1. Replace the CGNAT bind with a managed `tailscale serve` front door

**New module `src/ui/Serve.ts`, mirroring `src/ui/Tailscale.ts`'s split:** pure
parse functions plus thin `CommandRunner`-backed Effects. No new port — every
`tailscale` invocation goes through `CommandRunner.bash`, exactly as
`probeTailscaleStatus` and `obtainTailscaleCert` already do, so the `@inmem`
tier keeps scripting them.

Four exported pieces:

- `parseServeStatus(json)` — pure, over `tailscale serve status --json`,
  yielding the mapping (if any) currently published on a given HTTPS port and
  its target URL. `undefined` for unparseable JSON, no serve config, or no
  mapping on that port — the same "detection came back empty is never a failure"
  rule `parseTailscaleStatus` already sets.
- `publishServe({ servePort, targetPort })` — runs
  `tailscale serve --bg --https=<servePort> --set-path=/ http://127.0.0.1:<targetPort>`,
  yielding `{ ok: true }` or `{ ok: false, reason, output }`. A non-zero exit is
  a VALUE, never an Effect failure: the fallback below consumes it.
- `unpublishServe(servePort)` — `tailscale serve --https=<servePort> off`.
- The ownership record's read/write/delete.

**The plain-HTTP loopback listener** is the one piece with nothing to copy.
`HttpsServer` becomes `UiListener`, one tag, one method:
`listen({ tls?: CertPair, host, port, handler })`. `tls` present →
`https.createServer` with today's exact options; `tls` absent →
`http.createServer`. Every other line of that Live layer — the `EADDRINUSE`
mapping, the `error`-once handler, the bound-port readback — is untouched. One
method, not two, so `Server.test.ts`'s fake stays a single function.

**The ownership record** is a file at `~/.gtd/serve/<servePort>.json`, written
after a successful publish and containing
`{ pid, servePort, targetPort, target, worktree }`. There is no other gtd state
directory to put it in; it is created on demand. It is the whole basis of both
mandatory guarantees:

- **Teardown removes only our own mapping.** Before `unpublishServe`, re-read
  the record and `parseServeStatus`; unpublish only when the record exists AND
  the live mapping's target equals the record's `target`. A mapping we did not
  publish — collie's port-443 door, another instance — has no record and is left
  untouched. A record whose target no longer matches the live mapping is deleted
  without unpublishing: someone else took the port over.
- **Orphan clearing on start.** Before publishing, read the record for our serve
  port. No record and a live foreign mapping on that port → do not publish, fall
  back to the direct bind (never overwrite). A record whose `pid` is dead, or is
  our own → `unpublishServe`, delete the record, then publish fresh. `pid`
  liveness is `process.kill(pid, 0)`.

**Teardown on every exit path** rides the finalizer that already closes the
socket: `Deferred.await(handoffDeferred).pipe(Effect.ensuring(...))` in
`runUiCommand` gains the unpublish alongside `bound.close()`. That covers the
handoff exit and both signal exits, because `runMain` interrupts the fiber and
`ensuring` finalizers run on interrupt — that is a claim under test, not an
assumption: the SIGINT-exit-130 and SIGTERM-exit-143 scenarios in
`ui-lifecycle.feature` each grow an assertion that no mapping survives. A
`SIGKILL` is not coverable and is exactly what the orphan check exists for.

**Control flow in `runUiCommand`**, replacing `resolveHostsAndCert`:

1. An explicit `--host` or `ui.host` means the operator chose a bind address —
   skip serve entirely, take today's direct-bind path unchanged. Same for
   `--self-signed`.
2. Otherwise resolve the serve path: probe `tailscale serve status`, run the
   orphan check, `listen({ host: "127.0.0.1", port: 0 })` — an ephemeral target
   port, since nothing outside the machine dials it — then `publishServe` on
   `--port`/`ui.port` (default 8443). Serve accepts any port; the 443/8443/10000
   restriction is Funnel-only. Print `https://<hostname>/` (or `:<servePort>/`
   when not 443), the hostname coming from `probeTailscaleStatus`.
3. A failure at any step in 2 — no operator, serve unsupported, no tailnet HTTPS
   certs, a foreign mapping on the port — closes the loopback listener, prints
   one line naming why, and runs today's direct bind (`resolveBindHost` +
   `resolveCertPair` + a TLS `listen`) as the fallback. It never refuses.

**The dead code is smaller than it looks, because the fallback keeps the direct
bind alive.** `isTailscaleIPv4`, `pickBindHost`, `pickBindHostFromSystem`,
`resolveBindHost` and its "no Tailscale interface found to bind to" refusal,
`resolveCertPair`, `obtainTailscaleCert`, `generateSelfSignedCert` — all still
reachable through step 1 and step 3. Delete nothing in this package. The
`GtdUsageError`/exit-code surface is unchanged: the refusal that used to fire
when no tailnet interface existed now only fires on the fallback path, which is
strictly rarer, never new.

**Files:** `src/ui/Serve.ts` (new) + its test, `src/ui/Server.ts`,
`src/ui/Server.test.ts`, `tests/integration/features/ui.feature`,
`tests/integration/features/ui-lifecycle.feature`, `docs/cli.md` only if the
help text changes.

**Acceptance** (cucumber, alongside the existing two features): a working serve
path listens on loopback and prints the serve hostname, not a tailnet IP;
teardown removes this instance's mapping and leaves a foreign one untouched; a
crash-then-restart finds and clears its own orphan; a failing serve still yields
a reachable direct bind rather than a refusal.

### 2. The plan renders as the whole document, structure intact

**Server side, `src/OpenQuestions.ts`:** `paragraphNodesOf` becomes
`blockNodesOf` and drops both of its filters. It walks every top-level
`tree.children` node in document order and emits one view node per block,
skipping exactly two things: the `## Open Questions`/`## Answered Questions`
headings themselves (the client renders those as its own section headers), and
every node inside a question's own span (`parseOpenQuestions`'s
`sourceLine`..`endLine`, already computed). Everything else — before the
questions, between the two sections, after them — becomes a block node. That is
what "and the content after `## Open Questions` too" resolves to precisely, with
no second scoping rule.

`questionsView` no longer needs `questionsSectionHeadingIndex` or `isProseOnly`
as scoping devices: `nodes` is `[...blockNodes, ...questionNodes]`, and a
prose-only document is simply one where `questionNodes` is empty. The client
already splits on `status !== undefined`.

**`SteeringViewNode` gains one optional field, `block`**, and no anchor kind:

    readonly block?: {
      readonly kind: "paragraph" | "heading" | "list" | "code" | "blockquote"
      readonly depth?: number                  // heading level, 1–6
      readonly ordered?: boolean               // list
      readonly items?: readonly BlockListItem[] // list, recursive
      readonly language?: string               // code info string
      readonly text?: string                   // code body / quote text, verbatim
    }

with
`BlockListItem = { text: string; checked?: boolean; items?: readonly BlockListItem[] }`.
`title` keeps carrying the flattened one-line text for every kind, so a client
that ignores `block` still renders something. Nesting is unbounded and recursive
— the acceptance story renders a nested list.

The server projects structure rather than shipping raw markdown for the client
to parse: `SteeringView`'s whole point is that the client never re-derives
domain shape from file bytes (`PlanView`'s own `contentHash` doc comment says
so), and a browser-side markdown parser would be a new runtime dependency in the
bundle for a job the server already has a parsed tree for.

**Anchors need no new kind.** `resolveQuestionsParagraphAnchor` already resolves
through `blockNodeAt`, which returns ANY top-level block containing the line — a
heading, a list and a blockquote all resolve today, unchanged. Every block node
carries `{ kind: "paragraph", line }` at its own start line. `NoteSheet`'s
`ANCHOR_TITLE.paragraph` label changes to "Note on this block", since it is no
longer always a paragraph.

**The one anchor that does not work as-is is a fenced code block** — see the
open question. `footnoteAttachEdits` puts the marker at the end of
`anchor.line`, which for a fenced block is the opening fence: `[^n]` lands in
the info string, corrupts the fence, and never parses as a footnote reference.

**Client side, `src/web/screens/Plan.tsx`:** `ProseParagraph` becomes
`ProseBlock`, switching on `node.block?.kind` — `heading` → an `h2`/`h3`/`h4` by
`depth`, `list` → a recursive `ul`/`ol`, `code` → `pre > code`, `blockquote` →
`blockquote`, and anything else (including `block` absent) → the `p` it renders
today. The note seam and the inline note row are unchanged and render below
every kind. `ProseParagraphs` → `ProseBlocks`, keyed on the anchor line exactly
as now.

**Files:** `src/SteeringFormat.ts`, `src/OpenQuestions.ts`,
`src/OpenQuestions.test.ts`, `src/web/screens/Plan.tsx`,
`src/web/screens/Plan.stories.tsx`, `src/web/NoteSheet.tsx`.

**Acceptance:** a storybook story renders a plan containing a heading, a nested
list, a fenced code block and a paragraph after `## Open Questions`, and asserts
all four are on screen; a second attaches a note to a heading and asserts it
lands on that heading's own line.

### 3. Textboxes store on an explicit Save, never on type

**Deletions, all three write paths, no replacement:** in
`src/web/screens/Question.tsx` — `FREE_TEXT_DEBOUNCE_MS`,
`scheduleDebouncedCommit`, `clearDebounceTimer`, `debounceTimerRef`, the
unmount-commit `useEffect`, and the in-flight/pending serialization
(`commitInFlightRef`, `commitPendingRef`, `runCommitFreeText`,
`commitFreeTextRef`) — a deliberate tap cannot race a timer that no longer
exists. In `src/web/NoteSheet.tsx` — `NOTE_DEBOUNCE_MS`, `scheduleAutoSave`,
`runAutoSave`, the `onBlur` handler, the unmount `useEffect`, the
`lastAutoSavedRef`/`inFlightRef`/`pendingRef` trio, and the whole `onAutoSave`
prop. Its two wiring sites — `Plan.tsx`'s and `Review.tsx`'s `onAutoSave`
blocks, with their rethrow-on-rejection comments — go with it.

`commitFreeText` survives, unchanged in body, now called only from a Save tap.
Its changed-since-last-commit guard goes: an explicit tap always writes, and
`lastCommittedFreeTextRef` (and the ref-rollback half of its revert entry)
existed only to dedupe automatic firings. The per-field seq/revert machinery
stays as-is — a Save's write can still be refused, and it still touches both
`selected` and `freeText`.

**The draft moves out of the parent's `answers` map into `Question`'s own
`useState`, seeded from `defaultAnswerFor(node).freeText`.** This inverts the
controlled-state design deliberately, and the acceptance story is why: "types,
navigates away, returns, box is empty" is only true if the draft dies with the
component. `Deck`'s `renderItem` remounts a fresh `Question` per index, so a
local draft is discarded on navigate-away — exactly the requirement's "leaving
the view loses it". `selected` stays in the parent map, because radios still
write through immediately and their tap feedback must survive paging.
`QuestionAnswer` shrinks to `{ selected }`.

**The addition:** a Save button inside `FreeTextOption`, below the textarea,
`data-testid="free-text-save"`, styled like `NoteSheet`'s own Save. It calls
`commitFreeText` and does not navigate — ending a view is Done's job.
`NoteSheet`'s Save button already exists and keeps its exact behaviour (write,
then dismiss).

Radio options are untouched: `setSelected` still writes through on tap.

**Files:** `src/web/screens/Question.tsx`,
`src/web/screens/Question.stories.tsx`, `src/web/NoteSheet.tsx`,
`src/web/NoteSheet.stories.tsx`, `src/web/NoteSheet.test.ts`,
`src/web/screens/Plan.tsx`, `src/web/screens/Plan.stories.tsx`,
`src/web/screens/Review.tsx`, `src/web/screens/Review.stories.tsx`.

**Acceptance:** storybook stories that type into each textbox and assert no
mutation fired, blur and unmount and assert still nothing, then tap Save and
assert the write landed; plus one that types, navigates away, returns, and
asserts the box is empty.

### 4. The design-document Q&A view can end the turn without a note

**Server side, `src/ui/Router.ts`:** `done`'s input becomes
`{ note?: <today's writeNoteInput fields> }` — one optional nested object,
validated by the existing `writeNoteInput` when present, rather than six
independently-optional flat fields that can arrive in half-valid combinations.
`note` present → today's exact behaviour (write, refuse on a `WriteNoteRefusal`,
then `ctx.handOff()`). `note` absent → no write at all, straight to
`ctx.handOff()`; there is nothing to compare-and-swap, so no tokens are
required. The client is bundled with the server, so the nested shape needs no
compatibility shim.

**Client side:** `Deck` gains one optional prop pair, `onDone` plus its label.
When given, `DeckControls` appends a primary "Done" button, and its advance
button's last-item label reverts from "Done" to "Back to list" — two buttons
both reading "Done" on one screen is the collision this avoids. `Review.tsx`'s
hunk deck passes nothing and is entirely unchanged, last-item "Done" included.

`PlanView` gains `onDone?: () => Promise<unknown>` and passes it to its `Deck`.
`Plan`'s `usePlanMutations` grows `onDone` alongside `onDoneNote`, calling
`done.mutateAsync({})` with the same `.catch(onRefusal)` — fire-and-forget,
never rethrown, for the same reason `onDoneNote` isn't. `done.isSuccess` already
drives `HandedBackPanel`, so the terminal screen needs no new wiring.

**Files:** `src/ui/Router.ts`, `src/ui/Router.test.ts`, `src/web/Deck.tsx`,
`src/web/Deck.stories.tsx`, `src/web/screens/Plan.tsx`,
`src/web/screens/Plan.stories.tsx`,
`tests/integration/features/ui-lifecycle.feature`.

**Acceptance:** a storybook story taps Done from the question deck with no note
written and asserts the handed-back panel renders; a cucumber scenario asserts
the process exits the same way the existing handoff scenario does.

## Open Questions

### How does a note attach to a fenced code block, whose first line is the fence itself?

- [ ] A code block renders but carries no note seam — every other kind gets one.
      Nothing new to build, the document can never be corrupted, and the
      server-side anchor stays honest because the client simply offers no
      affordance for that one kind.
- [ ] `annotate` special-cases a code-block anchor: the marker goes on its own
      new line immediately after the closing fence, the definition after that.
      Notes work on every kind, at the cost of one invented line of markdown per
      note and a new branch in `resolveQuestionsAnchor`.
- [ ] _your answer_

### Does `gtd ui` gain a `ui.serve:` config key to force the direct bind off, or is `--host`/`ui.host` the only opt-out?

- [ ] No new key. `--host`/`ui.host` already means "bind here, skip serve", so a
      second switch is a second way to say the same thing — and every new
      `.gtdrc` key costs a `schema.json` regeneration and a docs surface.
- [ ] Add `ui.serve: false`. The two things are genuinely different asks —
      "publish nothing through tailscaled" versus "bind this address" — and an
      operator who wants the old behaviour on the tailnet IP currently has to
      look one up by hand to pass it.
- [ ] _your answer_

## Merged Concerns

None. All four footprints have distinct centres: concern 1 is `src/ui/`'s
server/network path, concern 2 is the server-side view builder in
`src/OpenQuestions.ts`, concern 3 is the two textarea components, concern 4 is
`Router.ts#done` plus `Deck`. `src/web/screens/Plan.tsx` appears in three of
them, but never as the centre of more than one, and concerns 3 and 4 only
consume the `view.nodes` shape concern 2 creates — the build-on-top exception,
not one blob.

## Answered Questions

### Does the anchor union gain new kinds for headings, lists, code blocks and blockquotes?

No. `{ kind: "paragraph", line }` already resolves through `blockNodeAt`, which
returns any top-level block containing that line, so one kind covers every
block. Renaming it to `block` would touch six files and `generated.html` for no
behaviour change; only the note sheet's label changes.

### Does the client render block structure from a server-side projection, or parse the raw markdown itself?

A server-side projection, in a new optional `block` field on `SteeringViewNode`.
A browser markdown parser would be a new runtime dependency duplicating work the
server already did, and `SteeringView` exists precisely so the client never
re-derives shape from file bytes.

### Where does the free-text draft live now that the parent's `answers` map would persist it?

In `Question`'s own local state. `Deck` remounts a fresh `Question` per index,
so a local draft dies on navigate-away — which is what the requirement's
"leaving the view loses it" means. `selected` stays in the parent map, since
radios write through immediately.

### Where does the turn-ending Done control live, and how does it avoid colliding with the deck's existing last-item "Done"?

In `Deck`'s own control row, behind an optional `onDone` prop. When supplied,
the advance button's last-item label becomes "Back to list"; the review deck
passes nothing and keeps its current label.

### Does `done` keep requiring compare-and-swap tokens when there is no note to write?

No. The tokens exist only to guard the write, so a note-less `done` sends an
empty input and goes straight to `handOff()`.

### Does the tailscale-serve front door replace the direct bind's code, or sit in front of it?

In front of it. The direct bind is the mandated fallback, so `resolveBindHost`,
`resolveCertPair`, `obtainTailscaleCert`, `generateSelfSignedCert` and the CGNAT
scan all stay reachable — through an explicit `--host`/`--self-signed` and
through the serve-failed path. This package deletes none of them.

### Which port does serve publish on, and which does the loopback listener bind?

Serve publishes on `--port`/`ui.port` (default 8443, since serve accepts any
port); the loopback listener binds `127.0.0.1:0` and lets the OS pick, because
nothing off the machine ever dials it.

### How does a running instance prove a serve mapping is its own?

A record file at `~/.gtd/serve/<servePort>.json` carrying
`{ pid, servePort, targetPort, target, worktree }`. Teardown unpublishes only
when the record's `target` still matches the live mapping; a mapping with no
record is foreign and left alone; a record with a dead `pid` is the orphan case,
cleared before publishing.

### Does the listener service split into an HTTP tag and an HTTPS tag?

No. One tag with one method, `listen({ tls?, host, port, handler })` — `tls`
absent selects `http.createServer`. Two methods would mean two fakes in
`Server.test.ts` for one socket.
