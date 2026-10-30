export type HashAlgorithm = "sha1" | "sha256"

export interface FileInfo {
  readonly type: "file" | "directory" | "symlink" | "other"
  /** `undefined` where the platform has no POSIX user ids. */
  readonly uid: number | undefined
}

/**
 * The machine reads that must stay synchronous: workflows read the tree
 * between two awaits during replay, so neither the reads nor the hashing
 * behind them can wait on IO. Absence is a value (`undefined`); any other
 * fault throws.
 */
export interface SyncIo {
  readonly readFile: (path: string) => Uint8Array | undefined
  readonly readText: (path: string) => string | undefined
  readonly writeText: (path: string, content: string) => void
  /** Creates every missing parent too. */
  readonly makeDirectory: (path: string) => void
  readonly rename: (from: string, to: string) => void
  /** Follows a symlink. */
  readonly stat: (path: string) => FileInfo | undefined
  /** Reports a symlink as one. */
  readonly lstat: (path: string) => FileInfo | undefined
  readonly readLink: (path: string) => string
  /** Throws when `path` does not exist. */
  readonly realPath: (path: string) => string
  /** git's stdout; throws on a non-zero exit, with git's stderr passed through. */
  readonly git: (cwd: string, args: readonly string[]) => string
  /** `git`'s raw stdout, with its stderr discarded. */
  readonly gitBytes: (cwd: string, args: readonly string[]) => Uint8Array
  /** Lowercase hex digest of the parts, concatenated; a string part is UTF-8. */
  readonly hash: (algorithm: HashAlgorithm, ...parts: readonly (string | Uint8Array)[]) => string
}
