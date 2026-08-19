import { Runtime } from "@effect/platform"
import { NodeRuntime } from "@effect/platform-node"
import { nodeCliIo, runCli } from "./Cli.js"

// The entire CLI lives behind `runCli` — argv in, exit code out. `runMain`
// stays for its signal handling: `visualize`/`lsp` block on Effect.never and
// must interrupt cleanly on Ctrl-C.
//
// `runMain`'s own SIGINT/SIGTERM handling interrupts the fiber and then
// exits 0 — an interrupted-only cause reads identically whether it came from
// a signal or nothing at all, so a plain Ctrl-C currently exits 0 rather than
// 130. `$?` reading 130/143 is only half the table's promise: a parent's
// `wait` (`WIFSIGNALED`) must see an actual signal death, not a chosen
// `process.exit(130)` that merely reuses the same number. Track which signal
// arrived and, once the fiber has finished interrupting (this teardown fires
// after that), remove our own listener and re-raise it — the runtime's
// interruption still unblocks `visualize`/`lsp`'s blocking wait first.
let deathSignal: NodeJS.Signals | undefined
process.once("SIGINT", () => {
  deathSignal = "SIGINT"
})
process.once("SIGTERM", () => {
  deathSignal = "SIGTERM"
})

NodeRuntime.runMain(runCli(process.argv, nodeCliIo), {
  teardown: (exit, onExit) => {
    if (deathSignal === undefined) {
      Runtime.defaultTeardown(exit, onExit)
      return
    }
    const signal = deathSignal
    process.removeAllListeners(signal)
    process.kill(process.pid, signal)
  },
})
