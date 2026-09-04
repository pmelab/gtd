import { vi } from "vitest"

// `tests/integration/features/serve.feature`'s `@inmem` scenarios run
// `gtd serve` IN-PROCESS (`world.ts`'s `runGtdInMem` calls the real `runCli`
// directly, not a spawned subprocess), so `resolveBindHost`'s default
// `pickHost` parameter reaches the real `os.networkInterfaces()`. On a
// machine or CI runner joined to a tailnet, that scan would find a real
// `100.64.0.0/10` address and the scenarios' "no Tailscale interface found"
// assertions would red for a reason that has nothing to do with a `serve`
// regression. Mocked here (a setup file shared by the whole `e2e-inmem`
// project) so the scan is deterministic; this has no effect on the `e2e-live`
// project, which spawns a genuinely separate `gtd` OS process no in-process
// mock can reach.
vi.mock("../../../../src/serve/Bind.js", () => ({ pickBindHostFromSystem: () => undefined }))
