import { Layer } from "effect"
import { CommandRunner } from "../platform/index.js"
import { UiShell } from "./Ports.js"

/** A real `bash -c` shell, the same one the composition root hands `gtd ui` — still needs `Host` and a `ChildProcessSpawner`. */
export const liveUiShell = Layer.effect(UiShell, CommandRunner).pipe(
  Layer.provide(CommandRunner.Live),
)
