import { NodeRuntime } from "@effect/platform-node"
import { nodeCliIo, runCli } from "./Cli.js"

// The entire CLI lives behind `runCli` — argv in, exit code out. `runMain`
// stays for its signal handling: `visualize`/`lsp` block on Effect.never and
// must interrupt cleanly on Ctrl-C.
NodeRuntime.runMain(runCli(process.argv, nodeCliIo))
