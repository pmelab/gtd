## TECHNICAL: replace the CGNAT bind with a managed `tailscale serve` front door

Binding a raw socket to the tailnet IP is the wrong reachability model. It works
on a direct LAN path and fails over a DERP relay, so `gtd ui` is reachable from
home and unreachable from outside. Replace it: listen on loopback, then publish
`tailscale serve --bg --https=<port> --set-path=/ <target>` and let tailscaled
terminate TLS. Copy the shape Collie already uses.

Serve accepts any port — the 443/8443/10000 restriction is Funnel-only — so one
mapping per instance is fine.

`HttpsServer.listen` creates an `https.createServer` unconditionally; there is
no plain-HTTP path in the codebase at all. Serve terminates TLS itself, so a
plain-HTTP loopback listener has to be added — it is part of this concern, not a
detail, and it is the one piece with no existing code to copy.

Three properties are mandatory, not optional polish:

- An ownership record, so teardown removes only a mapping this instance
  published. Serve config is node-global: without it one instance rips out
  another's mapping, or collie's own port-443 door.
- Teardown on every exit path, plus an orphan check on start. A crash otherwise
  leaves a mapping pointing at a dead port while the printed URL still looks
  valid. The existing SIGINT-exit-130 and handoff-exit paths both count.
- A fallback to today's direct bind when serve fails — operator not set, or no
  tailnet HTTPS certs available — rather than refusing to start.

The payoff is dead code: the CGNAT scan (`isTailscaleIPv4`, `pickBindHost`),
`resolveBindHost`'s "no Tailscale interface found to bind to" refusal,
`tailscale cert`/`obtainTailscaleCert`, and the self-signed branch all become
unreachable on the primary path. The fallback keeps the direct bind itself
alive, so delete only what the fallback no longer reaches.

Acceptance: cucumber scenarios alongside the existing `ui.feature` and
`ui-lifecycle.feature` — a working serve path listens on loopback and prints the
serve hostname rather than a tailnet IP; teardown removes this instance's
mapping and leaves a foreign one untouched; a crash-then-restart finds and
clears its own orphan; a failing serve still yields a reachable direct bind
instead of a refusal.

## PRODUCT: the plan renders as the whole document, structure intact

"Read the plan" shows a plan nobody can read. The row itself is fine — it writes
a `gtd:plan-read:<contentHash>` flag and shows a `✓`, and it stays exactly as it
is. The renderer is the bug: `paragraphNodesOf` keeps top-level `paragraph`
nodes only, and is scoped to everything before `## Open Questions`. Every
heading, list, code block and blockquote is dropped silently, and so is
everything after the questions section. A heading-and-list plan arrives as a
handful of orphan sentences.

Render the whole document with its structure: headings, lists, code blocks,
blockquotes, and the content after `## Open Questions` too.

Every node the view emits carries a real, server-computed anchor, and the client
hands that anchor straight back to `annotate` to attach a footnote. Paragraphs
have one today; headings, lists and code blocks do not. Extending the node set
without extending anchors breaks note attachment on the new kinds — the anchor
work is inside this concern, not after it.

This is the first product concern to build. It changes the shape of
`view.nodes`, which both later concerns render against; doing it first means
their stories are written once against the final shape.

Acceptance: a storybook story renders a plan containing a heading, a nested
list, a fenced code block and a paragraph after `## Open Questions`, and asserts
all four are on screen; a second attaches a note to a heading and asserts it
lands on that heading's own line.

## PRODUCT: textboxes store on an explicit Save, never on type

Both textareas debounce writes at 800 ms and flush on blur and on unmount. All
three write paths go: `FREE_TEXT_DEBOUNCE_MS` and `commitFreeTextOnBlur` in the
free-text answer slot, `NOTE_DEBOUNCE_MS` and its blur/unmount flush in the note
sheet. Typing updates local state and nothing else.

The note sheet already has a Save button. The question view has no buttons at
all, so the free-text slot needs one added — this concern is an addition, not
just a deletion. Its answer state is controlled by the parent's `answers` map,
so the draft has to live somewhere that a keystroke can touch without a write.

Text left unsaved is discarded. Leaving the view loses it — no draft that
survives navigation, no restore on reload. Save is the only write, taken
literally, so there is no persistence layer to build here.

Radio option selection keeps writing through immediately. The rule is about
textboxes; do not slow the radios down.

Acceptance: storybook stories — the phone UI's test tier — that type into each
textbox and assert no mutation fired, blur and unmount and assert still nothing,
then tap Save and assert the write landed; plus one that types, navigates away,
returns, and asserts the box is empty.

## PRODUCT: the design-document Q&A view can end the turn without a note

Ending currently requires opening the note sheet and writing something, because
`Save & Done` is the only affordance wired to `trpc.done`. A human who has
answered every question and has no note to leave has no way out of the deck.

The button ends the TURN, not the process: the same handoff `Save & Done`
already performs, minus the mandatory note, reachable straight from the Q&A
deck. The driver decides what happens next. Nothing here rewinds or abandons
anything.

Reuse the existing `done` round trip and the `HandedBackPanel` that follows it
rather than inventing a second path.

Acceptance: a storybook story taps Done from the question deck with no note
written and asserts the handed-back panel renders; a cucumber scenario asserts
the process exits the same way the existing handoff scenario does.

## Answered Questions

### What does "Read the plan" have to change — the row's behaviour, or what the plan renderer keeps?

The renderer. The row stays the read-confirmation it is, and the plan renders as
the whole document with headings, lists, code and blockquotes intact, including
the part after `## Open Questions`.

### What does the design-document view's Done button end — this turn, or the whole process?

The turn. It is the handoff `Save & Done` already performs, minus the mandatory
note, reachable from the Q&A deck; the driver decides what follows. Not
`gtd abandon`.

### What happens to text typed into a textbox and then left without tapping Save?

Discarded. Leaving the view loses it — no local draft, no survival across
navigation or reload.

### Do the plan-rendering fix and the Done button ship as one concern or two?

Two. They looked like one view, but they are not: the renderer touches the
server-side view builder and every screen that reads `view.nodes`, while the
Done button is a client affordance over an existing round trip. Each has its own
failing check, and the plan fix does not gate the Done button.

### Does tapping Save navigate away from the textbox?

No. Save writes and the human stays; ending a view is Done's job, not Save's.

### Does the read-confirmation `✓` and its localStorage key survive?

Yes. It is per-`contentHash`, so an edited plan correctly reverts to unconfirmed
— that behaviour is working and nobody asked for it back.
