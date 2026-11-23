import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
  type Stats,
} from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"
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
  // git records 100755 from the owner execute bit alone.
  ...(process.platform === "win32" ? {} : { executable: (stats.mode & 0o100) !== 0 }),
})

// A read must not take `index.lock` to refresh the index: it could fail gtd's own landing.
const READ_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: "0" }

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
  git: (cwd, args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: MAX_BUFFER, env: READ_ENV }),
  gitBytes: (cwd, args) =>
    execFileSync("git", args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "ignore"],
      env: READ_ENV,
    }),
  hash: (algorithm, ...parts) => {
    const hash = createHash(algorithm)
    for (const part of parts) hash.update(part)
    return hash.digest("hex")
  },
}

/** A private copy of the git index at `index`, so a refreshing read never takes `index.lock`. */
export const copyIndexToScratch = (index: string): { dir: string; copy: string } => {
  const dir = mkdtempSync(join(tmpdir(), "gtd-index-"))
  const copy = join(dir, "index")
  if (isAbsolute(index) && existsSync(index)) {
    copyFileSync(index, copy)
    // Git judges "racily clean" entries by the index's mtime; a fresh mtime hides a same-size edit.
    const { atime, mtime } = statSync(index)
    utimesSync(copy, atime, mtime)
  }
  return { dir, copy }
}

export const removeScratch = (dir: string): void => rmSync(dir, { recursive: true, force: true })
