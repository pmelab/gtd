# gtd ui: plain-HTTP mode for running behind a trusted local proxy

Closes pmelab/gtd#567 (https://github.com/pmelab/gtd/issues/567)

The workbench runs `gtd ui` per worktree as a pitchfork daemon behind
pitchfork's reverse proxy (`https://gate.<wt>.<proj>.internal`, also reached
over the tailnet). gtd ui insists on HTTPS ("HTTPS is mandatory and no
certificate is configured"), so the workbench uses `--self-signed` +
`proxy_tls = "passthrough"`: the browser sees gtd's throwaway cert (wrong host
name) and warns on every gate start, Mac and phone.

Want: a flag (e.g. `--behind-proxy` / `--http`) that serves plain HTTP, allowed
only when bound to a loopback address (`--host 127.0.0.1`/`::1`), so the proxy
terminates TLS with its own trusted CA. Refuse it on non-loopback binds. Keep
HTTPS mandatory everywhere else.

Acceptance:

- `gtd ui --http --host 127.0.0.1 --port N` serves the UI over HTTP on N.
- `--http` with a non-loopback host → usage error.
- Anything that builds absolute URLs/cookies (Secure flag, origin checks)
  behaves correctly behind an HTTPS proxy (trust `X-Forwarded-Proto` only in
  this mode).
- Docs (docs/cli.md) updated.
