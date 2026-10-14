import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { relative, sep } from "node:path"

/** Path (relative to `root`) → content hash of every file a config load touched. */
export type ConfigFingerprint = Readonly<Record<string, string>>

const HASH_LENGTH = 16

// A path the trailer cannot carry printably is never recorded, so it can never
// reach a terminal from history.
// eslint-disable-next-line no-control-regex -- the control range IS the point
const CONTROL_CHARACTER = /[\x00-\x1f\x7f-\x9f]/

export const contentHash = (content: string | Buffer): string =>
  createHash("sha256").update(content).digest("hex").slice(0, HASH_LENGTH)

const realOr = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

// An unreadable file is left out rather than failing: the fingerprint only
// feeds a warning, and the load that listed the file already read it.
// Paths are real paths: a loader may report `/private/var/…` for a root
// reached through the `/var` symlink, and the two must still relate.
export const configFingerprint = (
  files: readonly string[],
  root: string,
  read: (path: string) => string | undefined,
): ConfigFingerprint => {
  const fingerprint: Record<string, string> = {}
  const realRoot = realOr(root)
  for (const file of files) {
    const path = relative(realRoot, realOr(file)).split(sep).join("/")
    if (CONTROL_CHARACTER.test(path)) continue
    const content = read(file)
    if (content !== undefined) fingerprint[path] = contentHash(content)
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
