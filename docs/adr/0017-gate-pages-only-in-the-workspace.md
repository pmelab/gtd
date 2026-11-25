# Gate pages are served only by the workspace

gtd removes `gtd ui`. The supervisor of `gtd workspace` is the only process that
serves a gate page. It serves one for every worktree, with Proceed. We chose
this over keeping `gtd ui` next to it, because both served the same page from
the same code, and `gtd ui` added a second process per worktree, a second
listener and lifetime, and a page without Proceed. A person without a workspace
answers a steering file in an editor, or writes a small `gtd.workspace.ts`.

## Consequences

- This is a breaking change and ships as a major release. A `gtd.config.ts` that
  sets `config.ui` no longer loads.
- The listener, TLS, `tailscale serve` and auth code stays, because the
  supervisor uses it. Its tests move to `gtd workspace`.
- A tool that started `gtd ui` for one worktree must find the supervisor's gate
  page instead.
- The gate page edits a steering file with the supervisor's gtd, not with the
  process's pin. We accept this, because ADR 0009 keeps one widget format.
