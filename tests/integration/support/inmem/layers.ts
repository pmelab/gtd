/**
 * In-memory Effect layers backed by InMemRepo for integration tests.
 * No real filesystem or git is used.
 */

import { FileSystem } from "@effect/platform"
import { SystemError, type PlatformError } from "@effect/platform/Error"
import { Effect, Layer, Option } from "effect"
import { parse as parseYaml } from "yaml"
import { renderDiff } from "../../../../src/Diff.js"
import {
  GitService,
  type GitReaderOperations,
  type GitWriterOperations,
  type GitOperations,
} from "../../../../src/Git.js"
import { ConfigInit, ConfigService, type ConfigOperations } from "../../../../src/Config.js"
import { compileVarsMap, compileWorkflowConfig } from "../../../../src/PatternConfig.js"
import {
  defaultWorkflowDefinition,
  defaultWorkflowVars,
} from "../../../../src/workflows/default.js"
import { InMemRepo } from "./Repo.js"
import { Cwd } from "../../../../src/Cwd.js"
import { EnvVars } from "../../../../src/EnvVars.js"
import { WorktreeReader } from "../../../../src/WorktreeReader.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tryCatch = <A>(fn: () => A): Effect.Effect<A, Error> =>
  Effect.try({
    try: fn,
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

// Git's empty-tree object SHA: used as the diff base for a root commit (no parent).
// Mirrors InMemRepo's private EMPTY_TREE constant (used there for softResetTo).
const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

/**
 * Drop any changed path that falls under an excluded path (exact match or
 * `<excluded>/...` prefix) — shared by every diff* op below, each of which
 * only differs in which two refs it reads `before`/`after` content from.
 * An entry prefixed with `!` re-includes that path even when another entry
 * excludes it (mirrors `applyExcludes` in src/Git.ts).
 */
function excludingPaths<T extends { path: string }>(
  paths: ReadonlyArray<T>,
  exclude: ReadonlyArray<string>,
): ReadonlyArray<T> {
  if (exclude.length === 0) return paths
  const keeps = exclude.filter((e) => e.startsWith("!")).map((e) => e.slice(1))
  const drops = exclude.filter((e) => !e.startsWith("!"))
  return paths.filter(({ path }) => {
    if (keeps.some((keep) => path === keep || path.startsWith(`${keep}/`))) return true
    for (const ex of drops) {
      if (path === ex || path.startsWith(`${ex}/`)) return false
    }
    return true
  })
}

/**
 * Render the diff between two refs for a set of changed paths, resolving
 * each file's before/after content from `beforeRef`/`afterRef` (added files
 * have no `before`, deleted files have no `after`). Shared by `diffHead`,
 * `diffRef`, and `commitDiff`, which only differ in which refs and changed
 * paths they pass in.
 */
function renderPathDiff(
  repo: InMemRepo,
  paths: ReadonlyArray<{ path: string; status: string }>,
  exclude: ReadonlyArray<string>,
  beforeRef: string,
  afterRef: string,
): string {
  const filtered = excludingPaths(paths, exclude)
  if (filtered.length === 0) return ""

  const files = filtered.map(({ path, status }) => {
    const before = status === "A" ? null : (repo.fileAtRef(beforeRef, path) ?? null)
    const after = status === "D" ? null : (repo.fileAtRef(afterRef, path) ?? null)
    return { path, before, after }
  })

  return renderDiff(files)
}

// ---------------------------------------------------------------------------
// 1. GitReader.InMemory
// ---------------------------------------------------------------------------

const makeGitReaderOps = (repo: InMemRepo): GitReaderOperations => ({
  statusPorcelain: () => Effect.succeed(repo.statusPorcelain()),

  hasCommits: () => Effect.succeed(repo.hasCommits()),

  lastCommitSubject: () => {
    const subject = repo.lastCommitSubject()
    return subject !== null ? Effect.succeed(subject) : Effect.fail(new Error("No commits"))
  },

  resolveRef: (ref: string) => {
    const hash = repo.resolveRef(ref)
    return hash !== null
      ? Effect.succeed(hash)
      : Effect.fail(new Error(`Cannot resolve ref: ${ref}`))
  },

  readRefOption: (ref: string) => {
    const hash = repo.resolveRef(ref)
    return Effect.succeed(hash !== null ? Option.some(hash) : Option.none<string>())
  },

  topLevel: () => Effect.succeed("/repo"),

  resolveDefaultBranch: () => {
    const branch = repo.resolveDefaultBranch()
    return Effect.succeed(branch !== null ? Option.some(branch) : Option.none<string>())
  },

  mergeBase: (a: string, b: string) => {
    const result = repo.mergeBase(a, b)
    return Effect.succeed(result !== null ? Option.some(result) : Option.none<string>())
  },

  isAncestor: (a: string, b: string) => Effect.succeed(repo.isAncestor(a, b)),

  lastDeletionOf: (path: string) => {
    const hash = repo.lastDeletionOf(path)
    return Effect.succeed(hash !== null ? Option.some(hash) : Option.none<string>())
  },

  commitHistory: (base?: string) => Effect.succeed(repo.commitHistory(base)),

  diffHead: (exclude: ReadonlyArray<string> = []) =>
    Effect.sync(() => {
      const allPaths = repo.changedPathsWorktree()
      const filtered = excludingPaths(allPaths, exclude)
      if (filtered.length === 0) return ""

      const files = filtered.map(({ path, status }) => {
        const before = status === "A" ? null : (repo.fileAtRef("HEAD", path) ?? null)
        const after = status === "D" ? null : (repo["worktree"].get(path) ?? null)
        return { path, before, after }
      })

      return renderDiff(files)
    }),

  diffRef: (ref: string, exclude: ReadonlyArray<string> = []) =>
    Effect.sync(() => {
      const allPaths = repo.changedPathsBetween(ref, "HEAD")
      return renderPathDiff(repo, allPaths, exclude, ref, "HEAD")
    }),

  diffPath: (path: string) =>
    Effect.sync(() => {
      const before = repo.fileAtRef("HEAD", path)
      const after = repo["worktree"].get(path) ?? null

      if (before === null && after === null) return ""
      if (before === after) return ""

      return renderDiff([{ path, before, after }])
    }),

  commitDiff: (hash: string, exclude: ReadonlyArray<string> = []) =>
    tryCatch(() => {
      if (repo.resolveRef(hash) === null) {
        throw new Error(`Cannot resolve ref: ${hash}`)
      }
      const parent = repo.resolveRef(`${hash}~1`) ?? EMPTY_TREE_HASH
      const allPaths = repo.changedPathsBetween(parent, hash)
      return renderPathDiff(repo, allPaths, exclude, parent, hash)
    }),

  changedPaths: () => Effect.succeed(repo.changedPathsWorktree()),
})

// ---------------------------------------------------------------------------
// 2. GitWriter.InMemory
// ---------------------------------------------------------------------------

const makeGitWriterOps = (repo: InMemRepo): GitWriterOperations => ({
  commitAllWithPrefix: (prefix: string) => tryCatch(() => repo.commitAllWithPrefix(prefix)),

  softResetTo: (ref: string) => tryCatch(() => repo.softResetTo(ref)),

  commitAsIs: (message: string) => tryCatch(() => repo.commitAsIs(message)),

  discardPending: () => tryCatch(() => repo.discardPending()),

  updateRef: (ref: string, hash: string) => tryCatch(() => repo.updateRef(ref, hash)),

  deleteRef: (ref: string) => tryCatch(() => repo.deleteRef(ref)),

  mixedResetTo: (ref: string) => tryCatch(() => repo.mixedResetTo(ref)),

  restoreStagedFrom: (source: string, paths: ReadonlyArray<string>) =>
    tryCatch(() => repo.restoreStagedFrom(source, paths)),

  addIntentToAdd: () => tryCatch(() => repo.addIntentToAdd()),

  mixedResetHead: () => tryCatch(() => repo.mixedResetHead()),

  resetHard: () => tryCatch(() => repo.resetHard()),

  revertNoCommit: (ref: string) => tryCatch(() => repo.revertNoCommit(ref)),

  removeGtdDir: () => tryCatch(() => repo.removeGtdDir()),

  removePackageDir: (dir: string) => tryCatch(() => repo.removePackageDir(dir)),
})

// ---------------------------------------------------------------------------
// 3. In-memory FileSystem layer
// ---------------------------------------------------------------------------

const makeInMemoryFileSystem = (repo: InMemRepo): FileSystem.FileSystem => {
  // The worktree is accessible via private field — access via casting for now.
  // We'll use the public writeFile/deleteFile API for writes and access the
  // worktree state via the read APIs the Repo exposes.

  const getWorktree = (): Map<string, string> =>
    (repo as unknown as { worktree: Map<string, string> })["worktree"]

  const readFileString = (path: string): Effect.Effect<string, PlatformError> => {
    const worktree = getWorktree()
    const content = worktree.get(path)
    if (content === undefined) {
      return Effect.fail(
        new SystemError({
          reason: "NotFound",
          module: "FileSystem",
          method: "readFileString",
          pathOrDescriptor: path,
          description: `ENOENT: no such file or directory, open '${path}'`,
        }),
      )
    }
    return Effect.succeed(content)
  }

  const exists = (path: string): Effect.Effect<boolean, PlatformError> => {
    const worktree = getWorktree()
    // Check for exact file match
    if (worktree.has(path)) return Effect.succeed(true)
    // Check for directory: any path starts with `path/`
    const prefix = path.endsWith("/") ? path : `${path}/`
    for (const key of worktree.keys()) {
      if (key.startsWith(prefix)) return Effect.succeed(true)
    }
    return Effect.succeed(false)
  }

  const writeFileString = (path: string, data: string): Effect.Effect<void, PlatformError> => {
    repo.writeFile(path, data)
    return Effect.void
  }

  // fallow-ignore-next-line complexity
  const remove = (
    path: string,
    options?: FileSystem.RemoveOptions,
  ): Effect.Effect<void, PlatformError> => {
    const worktree = getWorktree()
    if (options?.recursive === true) {
      const prefix = path.endsWith("/") ? path : `${path}/`
      for (const key of worktree.keys()) {
        if (key === path || key.startsWith(prefix)) {
          repo.deleteFile(key)
        }
      }
    } else {
      if (!worktree.has(path)) {
        if (options?.force === true) return Effect.void
        return Effect.fail(
          new SystemError({
            reason: "NotFound",
            module: "FileSystem",
            method: "remove",
            pathOrDescriptor: path,
            description: `ENOENT: no such file or directory, unlink '${path}'`,
          }),
        )
      }
      repo.deleteFile(path)
    }
    return Effect.void
  }

  const makeDirectory = (
    _path: string,
    _options?: FileSystem.MakeDirectoryOptions,
  ): Effect.Effect<void, PlatformError> =>
    // Directories are implicit in the in-memory store
    Effect.void

  const realPath = (_path: string): Effect.Effect<string, PlatformError> =>
    // Return the path unchanged — the cwd guard in main.ts checks topLevel === cwd
    // We always return "/repo" for both, so the check passes.
    Effect.succeed("/repo")

  const readDirectory = (path: string): Effect.Effect<Array<string>, PlatformError> => {
    const worktree = getWorktree()
    const prefix = path.endsWith("/") ? path : `${path}/`
    const names = new Set<string>()
    for (const key of worktree.keys()) {
      if (key.startsWith(prefix)) {
        // Immediate child name (first path segment after the prefix)
        const rest = key.slice(prefix.length)
        const slash = rest.indexOf("/")
        const name = slash === -1 ? rest : rest.slice(0, slash)
        if (name.length > 0) names.add(name)
      }
    }
    return Effect.succeed([...names].sort())
  }

  const stat = (path: string): Effect.Effect<FileSystem.File.Info, PlatformError> => {
    const worktree = getWorktree()
    // Exact file
    if (worktree.has(path)) {
      return Effect.succeed({
        type: "File" as FileSystem.File.Type,
        mtime: Option.none<Date>(),
        atime: Option.none<Date>(),
        birthtime: Option.none<Date>(),
        dev: 0,
        ino: Option.none<number>(),
        mode: 0o100644,
        nlink: Option.none<number>(),
        uid: Option.none<number>(),
        gid: Option.none<number>(),
        rdev: Option.none<number>(),
        size: FileSystem.Size(BigInt(worktree.get(path)!.length)),
        blksize: Option.none<FileSystem.Size>(),
        blocks: Option.none<number>(),
      })
    }
    // Directory check
    const prefix = path.endsWith("/") ? path : `${path}/`
    for (const key of worktree.keys()) {
      if (key.startsWith(prefix)) {
        return Effect.succeed({
          type: "Directory" as FileSystem.File.Type,
          mtime: Option.none<Date>(),
          atime: Option.none<Date>(),
          birthtime: Option.none<Date>(),
          dev: 0,
          ino: Option.none<number>(),
          mode: 0o040755,
          nlink: Option.none<number>(),
          uid: Option.none<number>(),
          gid: Option.none<number>(),
          rdev: Option.none<number>(),
          size: FileSystem.Size(0n),
          blksize: Option.none<FileSystem.Size>(),
          blocks: Option.none<number>(),
        })
      }
    }
    return Effect.fail(
      new SystemError({
        reason: "NotFound",
        module: "FileSystem",
        method: "stat",
        pathOrDescriptor: path,
        description: `ENOENT: no such file or directory, stat '${path}'`,
      }),
    )
  }

  return FileSystem.makeNoop({
    readFileString,
    exists,
    writeFileString,
    remove,
    makeDirectory,
    realPath,
    readDirectory,
    stat,
  })
}

// ---------------------------------------------------------------------------
// 4. In-memory ConfigService layer
// ---------------------------------------------------------------------------

const SEARCH_PLACES = [
  ".gtdrc",
  ".gtdrc.json",
  ".gtdrc.yaml",
  ".gtdrc.yml",
  "gtd.config.json",
  "gtd.config.yaml",
]

const parseConfigContent = (filename: string, content: string): Record<string, unknown> => {
  try {
    const parsed: unknown = parseYaml(content)
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${filename}: config must be a plain object`)
    }
    return parsed as Record<string, unknown>
  } catch (e) {
    throw new Error(`${filename}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/**
 * Mirrors the real `Config.ts`'s `compileRcVars`: the top-level `.gtdrc`
 * `vars:` key, validated through the SAME `compileVarsMap` the real service
 * uses. Throws the same aggregated `"gtd config:\n  - ..."` shape on a bad
 * entry.
 */
const compileRcVars = (raw: unknown): Record<string, string> => {
  const errors: string[] = []
  const vars = compileVarsMap(raw, errors)
  if (errors.length > 0) {
    throw new Error(`gtd config:\n${errors.map((e) => `  - ${e}`).join("\n")}`)
  }
  return vars
}

/**
 * Mirrors the real `ConfigService.Live`'s `toOperations`: an absent
 * `workflow:` key compiles to the bundled default; a present one is compiled
 * through the SAME `compileWorkflowConfig` the real service uses — no
 * bespoke in-memory workflow interpretation. Likewise the top-level `vars:`
 * key goes through the same `compileRcVars` the real service uses.
 * `configDir` is `"/repo"` (this harness's fixed in-memory root, matching
 * `topLevel`/`realPath` above) so a scenario's custom workflow could
 * reference `./`-relative content if it ever needed to (none currently do;
 * every @inmem custom-workflow scenario writes inline content).
 */
const makeConfigOps = (raw: Record<string, unknown>): ConfigOperations => {
  const rcVars = compileRcVars(raw["vars"])
  if (raw["workflow"] === undefined) {
    return { workflow: defaultWorkflowDefinition, workflowVars: defaultWorkflowVars, rcVars }
  }
  const { definition, vars: workflowVars } = compileWorkflowConfig(raw["workflow"], "/repo")
  return { workflow: definition, workflowVars, rcVars }
}

const makeInMemoryConfigService = (repo: InMemRepo): Layer.Layer<ConfigService> => {
  const worktree = (repo as unknown as { worktree: Map<string, string> })["worktree"]

  const ops = Effect.sync((): ConfigOperations => {
    for (const name of SEARCH_PLACES) {
      const content = worktree.get(name)
      if (content !== undefined) {
        const raw = parseConfigContent(name, content)
        return makeConfigOps(raw)
      }
    }
    // No config file found → defaults
    return makeConfigOps({})
  })

  return Layer.effect(ConfigService, ops)
}

// ---------------------------------------------------------------------------
// 5. In-memory WorktreeReader layer
// ---------------------------------------------------------------------------

/** `PatternTemplates.TemplateContext.read` for the in-memory tier: a synchronous lookup straight into the repo's worktree map (never real `fs`). */
const makeInMemoryWorktreeReader = (repo: InMemRepo): Layer.Layer<WorktreeReader> => {
  const worktree = (repo as unknown as { worktree: Map<string, string> })["worktree"]
  return Layer.succeed(WorktreeReader, {
    read: (path: string) => {
      const content = worktree.get(path)
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`)
      }
      return content
    },
  })
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function inMemoryLayers(
  repo: InMemRepo,
  env: Readonly<Record<string, string | undefined>> = {},
): Layer.Layer<
  GitService | FileSystem.FileSystem | ConfigService | ConfigInit | Cwd | WorktreeReader | EnvVars
> {
  // Reader + Writer share the same repo instance
  const readerOps = makeGitReaderOps(repo)
  const writerOps = makeGitWriterOps(repo)
  const gitOps: GitOperations = { ...readerOps, ...writerOps }

  const gitServiceLayer = Layer.succeed(GitService, gitOps)

  const fsLayer = Layer.succeed(FileSystem.FileSystem, makeInMemoryFileSystem(repo))

  const configLayer = makeInMemoryConfigService(repo)

  return Layer.mergeAll(
    gitServiceLayer,
    fsLayer,
    configLayer,
    ConfigInit.Noop,
    Cwd.layer("/repo"),
    makeInMemoryWorktreeReader(repo),
    EnvVars.layer(env),
  )
}

// Fine-grained layer for unit tests that need only the git service.
export const makeGitServiceLayer = (repo: InMemRepo): Layer.Layer<GitService> =>
  Layer.succeed(GitService, {
    ...makeGitReaderOps(repo),
    ...makeGitWriterOps(repo),
  })
