import { pureHash, type FileInfo, type SyncIo } from "../platform/index.js"
import type { InMemRepo } from "./InMemRepo.js"

const MAX_LINKS = 40

const fault = (code: string, op: string, path: string): Error =>
  Object.assign(new Error(`${code}: ${op} '${path}'`), { code })

const parentOf = (path: string): string => path.slice(0, path.lastIndexOf("/")) || "/"

const joined = (dir: string, name: string): string => (dir === "/" ? `/${name}` : `${dir}/${name}`)

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { ignoreBOM: true })

export interface InMemorySyncIo extends SyncIo {
  readonly symlink: (path: string, target: string) => void
}

/**
 * A POSIX file system in memory, absolute paths only. Its git answers the
 * reads gtd makes from `repo`, rooted at `root`.
 */
export const inMemorySyncIo = (
  opts: { readonly repo?: InMemRepo; readonly root?: string; readonly uid?: number } = {},
): InMemorySyncIo => {
  const files = new Map<string, Uint8Array>()
  const links = new Map<string, string>()
  const dirs = new Set<string>(["/"])

  /** `path` with every symlink resolved, the last component's only when `followLast`. */
  const resolve = (path: string, followLast: boolean): string => {
    let pending = path.split("/").filter((part) => part.length > 0)
    let at = "/"
    let hops = 0
    while (pending.length > 0) {
      const [name, ...rest] = pending as [string, ...string[]]
      pending = rest
      if (name === ".") continue
      if (name === "..") {
        at = parentOf(at)
        continue
      }
      const next = joined(at, name)
      const target = links.get(next)
      if (target === undefined || (rest.length === 0 && !followLast)) {
        at = next
        continue
      }
      if (++hops > MAX_LINKS) throw fault("ELOOP", "resolve", path)
      if (target.startsWith("/")) at = "/"
      pending = [...target.split("/").filter((part) => part.length > 0), ...rest]
    }
    return at
  }

  const typeOf = (path: string): FileInfo["type"] | undefined =>
    links.has(path)
      ? "symlink"
      : files.has(path)
        ? "file"
        : dirs.has(path)
          ? "directory"
          : undefined

  const parentExists = (path: string): boolean =>
    typeOf(resolve(parentOf(path), true)) === "directory"

  const info = (path: string): FileInfo | undefined => {
    const type = typeOf(path)
    return type === undefined ? undefined : { type, uid: opts.uid }
  }

  const readFile = (path: string): Uint8Array | undefined => {
    const real = resolve(path, true)
    if (dirs.has(real)) throw fault("EISDIR", "read", path)
    return files.get(real)
  }

  const writeFile = (path: string, content: Uint8Array): void => {
    const real = resolve(path, true)
    if (!parentExists(real)) throw fault("ENOENT", "open", path)
    if (dirs.has(real)) throw fault("EISDIR", "open", path)
    files.set(real, content)
  }

  const makeDirectory = (path: string): void => {
    const real = resolve(path, true)
    const type = typeOf(real)
    if (type === "directory") return
    if (type !== undefined) throw fault("EEXIST", "mkdir", path)
    makeDirectory(parentOf(real))
    dirs.add(real)
  }

  const show = (repo: InMemRepo, spec: string): string => {
    const colon = spec.indexOf(":")
    const content = repo.fileAtRef(spec.slice(0, colon), spec.slice(colon + 1))
    if (content === null) throw new Error(`fatal: invalid object name '${spec}'`)
    return content
  }

  const revParse = (repo: InMemRepo, arg: string): string => {
    if (arg === "--show-object-format") return "sha1\n"
    const hash = repo.resolveRef(arg)
    if (hash === null) throw new Error(`fatal: ambiguous argument '${arg}'`)
    return `${hash}\n`
  }

  const git = (cwd: string, args: readonly string[]): string => {
    const { repo, root } = opts
    if (repo === undefined || resolve(cwd, true) !== root) {
      throw new Error(`fatal: not a git repository: ${cwd}`)
    }
    const [command, arg, ...rest] = args
    if (arg === undefined || rest.length > 0 || (command !== "show" && command !== "rev-parse")) {
      throw new Error(`in-memory git: unsupported \`git ${args.join(" ")}\``)
    }
    return command === "show" ? show(repo, arg) : revParse(repo, arg)
  }

  return {
    readFile,
    readText: (path) => {
      const bytes = readFile(path)
      return bytes === undefined ? undefined : decoder.decode(bytes)
    },
    writeText: (path, content) => writeFile(path, encoder.encode(content)),
    makeDirectory,
    rename: (from, to) => {
      const source = resolve(from, false)
      const target = resolve(to, false)
      const bytes = files.get(source)
      if (bytes === undefined) throw fault("ENOENT", "rename", from)
      if (!parentExists(target)) throw fault("ENOENT", "rename", to)
      links.delete(target)
      files.set(target, bytes)
      files.delete(source)
    },
    stat: (path) => info(resolve(path, true)),
    lstat: (path) => info(resolve(path, false)),
    readLink: (path) => {
      const target = links.get(resolve(path, false))
      if (target === undefined) throw fault("EINVAL", "readlink", path)
      return target
    },
    realPath: (path) => {
      const real = resolve(path, true)
      if (typeOf(real) === undefined) throw fault("ENOENT", "realpath", path)
      return real
    },
    git,
    gitBytes: (cwd, args) => encoder.encode(git(cwd, args)),
    hash: pureHash,
    symlink: (path, target) => {
      links.set(resolve(path, false), target)
    },
  }
}
