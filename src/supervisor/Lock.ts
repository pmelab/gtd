import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { UiError } from "../ui/index.js"

/** `<stateHome>/gtd/workspace/<hash of the workspace root>/`: outside every repository. */
export const stateDirectory = (stateHome: string, root: string): string =>
  join(stateHome, "gtd", "workspace", createHash("sha256").update(root).digest("hex").slice(0, 16))

interface Holder {
  readonly pid: number
  readonly url?: string
}

const readHolder = (path: string): Holder | undefined => {
  try {
    const holder = JSON.parse(readFileSync(path, "utf8")) as Partial<Holder>
    return typeof holder.pid === "number" ? (holder as Holder) : undefined
  } catch {
    return undefined
  }
}

export interface Lock {
  /** Records where this supervisor serves, for a second one to print. */
  readonly serving: (url: string) => void
  readonly release: () => void
}

/**
 * Takes the workspace's one supervisor lock, or fails naming the supervisor
 * that holds it. A lock whose pid is dead is stale and taken over.
 */
export const acquireLock = (
  directory: string,
  root: string,
  isPidAlive: (pid: number) => boolean,
): Lock => {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, "lock")
  const write = (holder: Holder, flag: "wx" | "w"): void =>
    writeFileSync(path, `${JSON.stringify(holder)}\n`, { flag, mode: 0o600 })
  try {
    write({ pid: process.pid }, "wx")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const holder = readHolder(path)
    if (holder !== undefined && isPidAlive(holder.pid)) {
      throw new UiError(
        `gtd workspace: a supervisor already runs for ${root} — pid ${holder.pid}, ${holder.url ?? "not serving yet"}`,
      )
    }
    write({ pid: process.pid }, "w")
  }
  return {
    serving: (url) => write({ pid: process.pid, url }, "w"),
    release: () => {
      if (readHolder(path)?.pid === process.pid) rmSync(path, { force: true })
    },
  }
}
