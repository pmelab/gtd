# Web Push replaces ntfy as the notifications adapter

The dashboard sends Web Push notifications to the devices that opt in. gtd
bundles this as the notifications adapter `webPush()`, and it is the default.
gtd removes `ntfy()`: it bundles no other notifications adapter. Web Push is not
a second channel built into the supervisor. For it, the notifications adapter
interface grows beyond `publish`: each adapter must also take the devices'
subscriptions and keep them, with its keys. We chose this over a built-in
channel next to the adapter, so that a workspace keeps one place that decides
where notifications go (ADR 0013). We chose it over a list of adapters, which
would give one adapter special access to the dashboard and the state. We removed
ntfy because the default sent worktree names to a public server, and Web Push
sends them end-to-end encrypted.

## Consequences

- This changes ADR 0013: the bundled default for notifications is Web Push, not
  ntfy.
- The new operations are required. A userland notifications adapter breaks, and
  the change ships as a major release.
- The supervisor still decides what to send and when. The adapter decides which
  device gets it.
- A device gets notifications only over a connection it trusts, and an iOS
  device only from a dashboard on its home screen. A workspace served with
  `--self-signed` gets no notifications.
- The payload encryption and VAPID signing come from the `web-push` npm package,
  not from code of our own.
