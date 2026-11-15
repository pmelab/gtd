import { createHash, randomBytes } from "node:crypto"
import { linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
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
  const refuse = (holder: Holder | undefined): never => {
    throw new UiError(
      `gtd workspace: a supervisor already runs for ${root} — pid ${holder?.pid ?? "unknown"}, ${holder?.url ?? "not serving yet"}`,
    )
  }
  const claim = (): boolean => {
    try {
      write({ pid: process.pid }, "wx")
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      return false
    }
  }
  // A takeover moves the stale lock aside first: of two supervisors taking it over, one moves it.
  const takeOver = (stale: Holder | undefined): void => {
    const aside = `${path}.${process.pid}.${randomBytes(4).toString("hex")}`
    try {
      renameSync(path, aside)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    const moved = readHolder(aside)
    if (moved !== undefined && moved.pid !== stale?.pid) {
      // It was another supervisor's fresh lock: put it back.
      try {
        linkSync(aside, path)
      } catch {
        // A third supervisor claimed the lock meanwhile: it holds it now.
      }
      rmSync(aside, { force: true })
      refuse(moved)
    }
    rmSync(aside, { force: true })
    if (!claim()) refuse(readHolder(path))
  }
  if (!claim()) {
    const holder = readHolder(path)
    if (holder !== undefined && isPidAlive(holder.pid)) refuse(holder)
    takeOver(holder)
  }
  return {
    serving: (url) => write({ pid: process.pid, url }, "w"),
    release: () => {
      if (readHolder(path)?.pid === process.pid) rmSync(path, { force: true })
    },
  }
}
