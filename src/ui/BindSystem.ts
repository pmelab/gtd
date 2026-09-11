import * as os from "node:os"
import { pickBindHost } from "./Bind.js"

/**
 * Production entry point: delegates to `pickBindHost` with the real
 * interfaces. Split out of `Bind.ts` so a mock of the real-system call
 * (`vi.mock(".../BindSystem.js", ...)`, used by `program.test.ts`,
 * `Server.test.ts`, and `ui.steps.ts` to avoid touching the real network)
 * never has to stub out `pickBindHost`'s own pure logic too, and a change to
 * that logic never ripples into those three unrelated mock sites.
 */
export const pickBindHostFromSystem = (): string | undefined => pickBindHost(os.networkInterfaces())
