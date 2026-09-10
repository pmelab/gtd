## TECHNICAL: replace the CGNAT bind with a managed `tailscale serve` front door

Binding a raw socket to the tailnet IP is the wrong reachability model. It works
on a direct LAN path and fails over a DERP relay, so `gtd ui` is reachable from
home and unreachable from outside. Replace it: listen on loopback, then publish
`tailscale serve --bg --https=<port> --set-path=/ <target>` and let tailscaled
terminate TLS. Copy the shape Collie already uses.

Serve accepts any port — the 443/8443/10000 restriction is Funnel-only — so one
mapping per instance is fine.

Three properties are mandatory, not optional polish:

- An ownership record, so teardown removes only a mapping this instance
  published. Serve config is node-global: without it one instance rips out
  another's mapping, or collie's own port-443 door.
- Teardown on every exit path, plus an orphan check on start. A crash otherwise
  leaves a mapping pointing at a dead port while the printed URL still looks
  valid.
- A fallback to today's direct bind when serve fails — operator not set, or no
  tailnet HTTPS certs available — rather than refusing to start.

The payoff is dead code: the CGNAT scan, `tailscale cert`,
`obtainTailscaleCert`, and the self-signed branch all become unreachable once
serve is the primary path. The fallback keeps the direct bind itself alive.

## PRODUCT: textboxes store on an explicit Save, never on type

Every textbox in the phone client must write only when the human taps Save.
Typing updates local state and nothing else — no debounced write-through, no
store-on-keystroke, no store-on-blur.

This lands against the free-text answer slot and the note sheet alike.

## PRODUCT: the design-document Q&A view needs a Done button that ends the process

The Q&A view of a design document has no way to declare the round finished. Add
a Done button that terminates the process from that view.

## PRODUCT: "Read the plan" must display the plan

The "Read the plan" affordance does not show the plan. It has to actually render
the document's content.
