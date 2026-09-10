# Spec feedback — 01 Tailscale serve front door

## The loopback bind can still refuse instead of falling back

Task 3 step 3: "A failure at **any** step in 2 — ... — closes the loopback
listener, prints one line naming why, and runs today's direct bind instead. It
never refuses."

`attemptServe` (`src/ui/Server.ts`) catches every failure except one: the
loopback bind itself.

```ts
const bound = yield * uiListener.listen({ host: "127.0.0.1", port: 0, handler })
```

No `Effect.catchAll`. `UiListener.listen` fails with `GtdError` (EADDRINUSE, or
any other `error` event — EMFILE, a sandbox that denies the loopback bind), and
that failure propagates straight out of `attemptServe` → `resolveListener` →
`runUiCommand`. `gtd ui` refuses instead of taking the direct bind.

This also makes `attemptServe`'s own doc comment false: it claims "it never
fails the Effect, so `runUiCommand` always has a direct-bind fallback
available", while its signature is
`Effect.Effect<ServeAttempt, GtdError, CommandRunner>` — a `GtdError` error
channel is exactly what that sentence denies.

Fix shape: catch the `listen` failure into `{ ok: false, reason: ... }` like the
`publishServe` failure directly below it, and narrow `attemptServe`'s error
channel to `never` so the invariant is type-enforced rather than asserted in
prose. Add a unit test alongside the existing "tailscale serve itself fails to
publish" case, with a fake `UiListener` that fails the `127.0.0.1` bind and
succeeds the direct bind, asserting the fallback line plus today's URL.

## `hooks.ts` names a feature file that does not exist

`FAKE_TAILSCALE_SCRIPT`'s doc comment in `tests/integration/support/hooks.ts`
reads "package 01's own `ui-serve.feature` scenarios". There is no
`ui-serve.feature` — the serve scenarios live in
`tests/integration/features/ui-lifecycle.feature`. Point the comment at the real
file.
