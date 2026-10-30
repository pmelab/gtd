import { Runtime } from "effect"
import { NodeRuntime } from "@effect/platform-node-shared"
import { nodeCliIo, runCli, runLauncher } from "./cli/index.js"
import { livePinFile, nodeStdio, runPinModule } from "./platform/index.js"
import { PIN_PATH } from "./wire/index.js"
import { liveToolCommands } from "./program.js"

const runLive = (argv: readonly string[]): void => {
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
    deathSignal ??= "SIGTERM"
  })
  // `runMain` interrupts on SIGINT/SIGTERM only. A hangup (closed terminal,
  // dropped SSH) must interrupt too, so it dies by the same path.
  process.once("SIGHUP", () => {
    deathSignal = "SIGHUP"
    process.kill(process.pid, "SIGTERM")
  })

  NodeRuntime.runMain(runCli(argv, nodeCliIo(liveToolCommands)), {
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
}

// The pin's engine installs its own signal handling: nothing above may run
// before the hand-over, or both engines would answer one signal.
await runLauncher(process.argv, livePinFile(process.cwd(), PIN_PATH), {
  ...nodeStdio(),
  live: runLive,
  pin: (launch) => runPinModule(launch.path, launch.source()),
})
