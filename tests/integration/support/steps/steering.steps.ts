import { Given } from "quickpickle"
import type { GtdWorld } from "../world.js"

// Scripts one `bash` command for the @inmem tier's fake shell
// (`applyEmittedScript`): real subprocess execution is unreachable against an
// in-memory worktree, so a command an emitted script runs is declared here,
// keyed by the exact command string. An unscripted command fails loudly,
// never silently succeeds.

Given(
  "the shell command {string} exits {int} with:",
  (world: GtdWorld, command: string, status: number, output: string) => {
    world.scriptedCommands.set(command, { kind: "exit", status, output })
  },
)
