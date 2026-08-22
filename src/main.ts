import { Runtime } from "@effect/platform"
import { NodeRuntime } from "@effect/platform-node"
import { nodeCliIo, runCli } from "./Cli.js"

// `runMain`'s own SIGINT/SIGTERM handling interrupts the fiber and exits 0,
// which reads as a plain exit rather than a signal death to a parent's `wait`
// (WIFSIGNALED) — `process.exit(130)` merely reuses the number, it doesn't
// make one. So track which signal arrived and, once the fiber has finished
// interrupting, remove our own listener and re-raise the real signal instead.
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
