import { vi } from "vitest"

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
