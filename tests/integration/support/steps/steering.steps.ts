import { Given } from "quickpickle"
import type { GtdWorld } from "../world.js"

// Scripts one `bash` command for the @inmem tier's `CommandRunner` — real
// subprocess execution is unreachable against an in-memory worktree, so a
// mode's `format:`/`validate:` command must be declared here, keyed by the
// exact command string AFTER Eta rendering (what `bash` would actually
// receive). An unscripted command fails loudly (`inmem/layers.ts`'s
// `makeScriptedCommandRunner`), never silently succeeds.

Given(
  "the shell command {string} exits {int} with:",
  (world: GtdWorld, command: string, status: number, output: string) => {
    world.scriptedCommands.set(command, { kind: "exit", status, output })
  },
)

Given(
  "the shell command {string} rewrites {string} to:",
  (world: GtdWorld, command: string, file: string, content: string) => {
    const normalized = content.endsWith("\n") ? content : content + "\n"
    world.scriptedCommands.set(command, { kind: "rewrite", file, content: normalized })
  },
)
