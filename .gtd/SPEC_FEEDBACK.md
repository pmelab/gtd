# Spec feedback: 02-tailscale-url-and-cert

Everything except the "Cover both paths end to end" task holds: the parser, the
probe, the bind/display split, the fourth `resolveCertPair` branch, both
rewritten doc comments, and the regenerated `docs/cli.md` pin all match the
spec, and the unit tiers pass.

## 1. The two new `ui.feature` scenarios red `npm test` on any machine that is not joined to a tailnet

`tests/integration/features/ui.feature:274` and `:307` are `@live` and spawn
`gtd ui` with NO `--host`, so `resolveBindHost` reaches the real
`os.networkInterfaces()` scan. `tests/integration/support/world.ts:568`'s own
comment states the dependency outright: "this machine carries a genuine
Tailscale CGNAT interface". With no `100.64.0.0/10` address present,
`resolveBindHost` refuses, no URL is printed, and `world.ts:563`'s assertion
fails after 5s.

`package.json:35`'s `test` script runs `test:e2e:live`, so this is not an opt-in
tier — it reds `format:check`/`review-gate`/`fix-precheck` alike on a CI runner
or any dev machine off the tailnet.

It also contradicts the rule the same feature file states 20 lines above, at
`ui.feature:252-259`: a `@live` scenario must not depend on "the CI/dev
machine's real network shape", which is why the `resolveBindHost` coverage was
kept at the unit tier.

And it misses the spec's own criterion for this task: "Both are driven by a
`CommandRunner` double, never a real `tailscale` binary." A `$PATH` shim
(`ui.steps.ts:35`, `:49`) satisfies "never a real binary" but is not a
`CommandRunner` double, and a spawned subprocess cannot take one — the coverage
belongs at a tier where the double is injectable (in-process/`@inmem` or
`Server.test.ts`, where `pickBindHostFromSystem` and `CommandRunner` are both
already mockable), not at `@live`.

## 2. Neither scenario asserts the QR code, and as written neither can

Both criteria name the QR code — "asserts the printed URL and the QR code carry
the tailnet hostname" — but `ui.feature:303` asserts only
`stdout contains "https://phone.tailnet.ts.net:"` and `:336-337` only the URL
line. `world.ts#spawnGtdUiPrintingUrl` (`world.ts:583`) throws away every stdout
line but the first (`stdout: ${boundUrl}\n`), so the rendered QR body is
structurally unreachable from any step. Either capture full stdout and assert
over the QR block, or pin the QR/URL pairing at the unit tier where
`renderQrCode`'s input is observable.
