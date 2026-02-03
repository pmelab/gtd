import { Effect } from "effect"
import { homedir } from "node:os"

const relativePath = (): string => {
  const home = homedir()
  const cwd = process.cwd()
  return cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd
}

export const notify = (title: string, body: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const message = `${body}\n${relativePath()}`
    const cmd =
      process.platform === "darwin"
        ? [
            "osascript",
            "-e",
            `display notification "${message}" with title "${title}" sound name "default"`,
          ]
        : process.platform === "linux"
          ? ["notify-send", title, message]
          : undefined
    if (!cmd) return
    yield* Effect.tryPromise({
      try: () => Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).exited,
      catch: () => undefined,
    }).pipe(Effect.catchAll(() => Effect.void))
  })
