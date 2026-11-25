# The tailnet identity is the only authentication of the web pages

`gtd workspace` and its gate pages have no login. Each request is attributed to
the tailnet user that sent it (`Tailscale-User-Login` under `tailscale serve`,
`tailscale whois` for a direct bind), and it is refused unless that user is in
`ui.users`. The default is the user that owns the node. State changes also need
a POST with a JSON body from the same origin. We chose this over a login page or
tokens, because the pages are reached only over the tailnet, which already
identifies every peer, and because a second credential would be one more secret
to store, rotate and leak.

## Consequences

- Behind `--http`, the local proxy is trusted to have done this check, and the
  bind stays on loopback.
- The CLI talks to the supervisor through a Unix socket with mode 0600. File
  permissions are its authentication.
- A deployment off the tailnet is not supported. Adding one needs a new
  decision, not a setting.
