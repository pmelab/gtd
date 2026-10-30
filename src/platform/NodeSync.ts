import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
  type Stats,
} from "node:fs"
import type { FileInfo, SyncIo } from "./SyncIo.js"

// A tree listing, or one committed file, can overflow execFileSync's 1 MB default.
const MAX_BUFFER = 256 * 1024 * 1024

const isAbsent = (e: unknown): boolean => {
  const code = (e as NodeJS.ErrnoException).code
  return code === "ENOENT" || code === "ENOTDIR"
}

const orAbsent = <A>(read: () => A): A | undefined => {
  try {
    return read()
  } catch (e) {
    if (isAbsent(e)) return undefined
    throw e
  }
}

const infoOf = (stats: Stats): FileInfo => ({
  type: stats.isSymbolicLink()
    ? "symlink"
    : stats.isDirectory()
      ? "directory"
      : stats.isFile()
        ? "file"
        : "other",
  uid: process.platform === "win32" ? undefined : stats.uid,
})

export const nodeSyncIo: SyncIo = {
  readFile: (path) => orAbsent(() => readFileSync(path)),
  readText: (path) => orAbsent(() => readFileSync(path, "utf8")),
  writeText: (path, content) => writeFileSync(path, content, "utf8"),
  makeDirectory: (path) => {
    mkdirSync(path, { recursive: true })
  },
  rename: renameSync,
  stat: (path) => orAbsent(() => infoOf(statSync(path))),
  lstat: (path) => orAbsent(() => infoOf(lstatSync(path))),
  readLink: (path) => readlinkSync(path, "utf8"),
  realPath: (path) => realpathSync(path),
  git: (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: MAX_BUFFER }),
  gitBytes: (cwd, args) =>
    execFileSync("git", args, { cwd, maxBuffer: MAX_BUFFER, stdio: ["ignore", "pipe", "ignore"] }),
  hash: (algorithm, ...parts) => {
    const hash = createHash(algorithm)
    for (const part of parts) hash.update(part)
    return hash.digest("hex")
  },
}
