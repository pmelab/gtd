import type { Path } from "effect"
import type { SyncIo } from "../platform/index.js"

/** Path (relative to `root`) → content hash of every file a config load touched. */
export type ConfigFingerprint = Readonly<Record<string, string>>

const HASH_LENGTH = 16

// A path with a control character is never recorded, so it can never
// reach a terminal from history.
// eslint-disable-next-line no-control-regex -- the control range IS the point
const CONTROL_CHARACTER = /[\x00-\x1f\x7f-\x9f]/

const realOr = (io: SyncIo, path: string): string => {
  try {
    return io.realPath(path)
  } catch {
    return path
  }
}

// An unreadable file is left out rather than failing: the fingerprint only
// feeds a warning, and the load that listed the file already read it.
// Paths are real paths: a loader may report `/private/var/…` for a root
// reached through the `/var` symlink, and the two must still relate.
export const configFingerprint = (
  io: SyncIo,
  paths: Path.Path,
  files: readonly string[],
  root: string,
  read: (path: string) => string | undefined,
): ConfigFingerprint => {
  const fingerprint: Record<string, string> = {}
  const realRoot = realOr(io, root)
  for (const file of files) {
    const path = paths.relative(realRoot, realOr(io, file)).split(paths.sep).join("/")
    if (CONTROL_CHARACTER.test(path)) continue
    const content = read(file)
    if (content !== undefined) fingerprint[path] = io.hash("sha256", content).slice(0, HASH_LENGTH)
  }
  return fingerprint
}

export const changedConfigFiles = (
  recorded: ConfigFingerprint,
  current: ConfigFingerprint,
): readonly string[] =>
  [...new Set([...Object.keys(recorded), ...Object.keys(current)])]
    .filter((path) => recorded[path] !== current[path])
    .sort()
