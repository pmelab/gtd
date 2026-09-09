import { Given, When } from "quickpickle"
import { chmodSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { vi } from "vitest"
import type { GtdWorld } from "../world.js"

// `tests/integration/features/ui.feature`'s `@inmem` scenarios run
// `gtd ui` IN-PROCESS (`world.ts`'s `runGtdInMem` calls the real `runCli`
// directly, not a spawned subprocess), so `resolveBindHost`'s default
// `pickHost` parameter reaches the real `os.networkInterfaces()`. On a
// machine or CI runner joined to a tailnet, that scan would find a real
// `100.64.0.0/10` address and the scenarios' "no Tailscale interface found"
// assertions would red for a reason that has nothing to do with a `ui`
// regression. Mocked here (a setup file shared by the whole `e2e-inmem`
// project) so the scan is deterministic; this has no effect on the `e2e-live`
// project, which spawns a genuinely separate `gtd` OS process no in-process
// mock can reach.
//
// MUST load before `world.ts` in `setup-files.ts`'s own list: `world.ts`
// statically imports `Cli.js`, which eagerly loads the real `BindSystem.js`
// through `program.ts` -> `ui/Server.js`. Once that real module is loaded and
// cached, a `vi.mock` registered afterward (in a setup file later in the
// list) never takes effect — the mock must be registered before ANYTHING
// else in the setup chain imports this module transitively.
vi.mock("../../../../src/ui/BindSystem.js", () => ({ pickBindHostFromSystem: () => undefined }))

/**
 * `@live` only — installs a fake `tailscale` on `world.pathShimDir`, ahead
 * of the real `/opt/homebrew/bin/tailscale` in `$PATH` (`spawnEnv` prepends
 * the shim dir), so `Tailscale.ts#probeTailscaleStatus`'s `tailscale status
 * --json` call answers deterministically — never the real binary's actual
 * tailnet state, which the test runner can't control.
 */
Given(
  "a fake tailscale binary on PATH reporting a running backend with hostname {string}",
  (world: GtdWorld, hostname: string) => {
    if (!world.pathShimDir) throw new Error("no PATH shim dir — this step is @live only")
    const shim = join(world.pathShimDir, "tailscale")
    const status = JSON.stringify({
      BackendState: "Running",
      Self: { DNSName: `${hostname}.`, CertDomains: [hostname] },
    })
    writeFileSync(shim, `#!/bin/sh\ncat <<'EOF'\n${status}\nEOF\n`, { mode: 0o755 })
    chmodSync(shim, 0o755)
  },
)

/** The empty-probe case: a fake `tailscale` that reports a backend that isn't `"Running"` — one of the three ways `Tailscale.ts#parseTailscaleStatus` falls back to `undefined`. */
Given("a fake tailscale binary on PATH reporting no backend", (world: GtdWorld) => {
  if (!world.pathShimDir) throw new Error("no PATH shim dir — this step is @live only")
  const shim = join(world.pathShimDir, "tailscale")
  writeFileSync(shim, `#!/bin/sh\necho '{"BackendState":"Stopped"}'\n`, { mode: 0o755 })
  chmodSync(shim, 0o755)
})

/** Spawns a real `gtd ui --self-signed --port 0` with NO `--host` — the shape that lets `resolveBindHost` reach the real system scan and `runUiCommand` reach the Tailscale probe (`world.ts#spawnGtdUiPrintingUrl`'s own doc comment) — then kills it, leaving its printed URL in `lastResult.stdout` for the shared "stdout contains" step. */
When("I spawn gtd ui without --host and capture its printed URL", async (world: GtdWorld) => {
  await world.spawnGtdUiPrintingUrl()
})
