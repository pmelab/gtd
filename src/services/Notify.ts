import { Command, CommandExecutor } from "@effect/platform"
import { Effect, Stream } from "effect"
import { homedir } from "node:os"

const relativePath = (): string => {
  const home = homedir()
  const cwd = process.cwd()
  return cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd
}

export const notify = (
  title: string,
  body: string,
): Effect.Effect<void, never, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    const message = `${body}\n${relativePath()}`
    let args: string[] | undefined
    if (process.platform === "darwin") {
      args = [
        "osascript",
        "-e",
        `display notification "${message}" with title "${title}" sound name "default"`,
      ]
    } else if (process.platform === "linux") {
      args = ["notify-send", title, message]
    }
    if (!args) return
    const [cmd, ...rest] = args
    yield* Effect.gen(function* () {
      const proc = yield* Command.start(Command.make(cmd!, ...rest))
      yield* proc.stdout.pipe(Stream.runDrain)
      yield* proc.stderr.pipe(Stream.runDrain)
      yield* proc.exitCode
    }).pipe(Effect.scoped, Effect.ignore)
  })
