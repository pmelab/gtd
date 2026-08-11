/**
 * The in-memory tier's Effect layers, backed by one `InMemRepo`. No real
 * filesystem or git is used. `testLayers` is the ONE layer-set builder every
 * `@inmem` scenario and `src/**\/*.test.ts` unit test provides — see
 * `CommandRequirements` (`src/program.ts`) for what it must cover.
 *
 * Subprocess work goes through `CommandRunner` (#157), which `testLayers`
 * provides as a SCRIPTED runner: an `@inmem` scenario declares each command's
 * canned outcome and an unscripted command fails loudly, so nothing shells out
 * to real bash with `cwd: "/repo"` (a path that doesn't exist). `Visualize.ts`'s
 * browser `spawn` is still portless, but no `@inmem` scenario reaches it.
 */

import { FileSystem } from "@effect/platform"
import { SystemError, type PlatformError } from "@effect/platform/Error"
import { Effect, Layer, Option } from "effect"
import { GitService, withIndexLockRetries } from "../Git.js"
import {
  ConfigService,
  SEARCH_PLACES,
  configServiceLayer,
  parseConfigLevel,
  type ConfigLevel,
  type ConfigSource,
} from "../Config.js"
import type { FileRefReader } from "../PatternConfig.js"
import { fakeGitOperations } from "./GitDoubles.js"
import { InMemRepo } from "./InMemRepo.js"
import { Cwd } from "../Cwd.js"
import { EnvVars } from "../EnvVars.js"
import { RepoFiles } from "../RepoFiles.js"
import { CommandRunner, type CommandOutcome } from "../CommandRunner.js"
import type { CommandRequirements } from "../program.js"

// ---------------------------------------------------------------------------
// 1. In-memory FileSystem layer
// ---------------------------------------------------------------------------

const makeInMemoryFileSystem = (repo: InMemRepo, root: string): FileSystem.FileSystem => {
  // `.git/`-rooted paths have no production consumer through this layer —
  // gtd keeps no driver-scoped files at all (sessions are derived, stall is
  // history) — so a stray write under the fake git dir must FAIL
  // rather than silently fall through to the `worktree` store, which would
  // make it surface as a pending change (real git never reports a `.git/**`
  // path as one). See `InMemRepo.ts`'s module doc comment for the same
  // boundary on the git-side store this used to route to.
  const gitDirPrefix = `${root}/.git/`
  const isGitDirPath = (path: string): boolean => path.startsWith(gitDirPrefix)

  const gitDirNotFound = (method: string, path: string): SystemError =>
    new SystemError({
      reason: "NotFound",
      module: "FileSystem",
      method,
      pathOrDescriptor: path,
      description: `ENOENT: no such file or directory, '${method}' '${path}' — the in-memory fake has no git-dir file store`,
    })

  const readFileString = (path: string): Effect.Effect<string, PlatformError> => {
    if (isGitDirPath(path)) return Effect.fail(gitDirNotFound("readFileString", path))
    const content = repo.readFile(path)
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

  const exists = (path: string): Effect.Effect<boolean, PlatformError> =>
    isGitDirPath(path) ? Effect.succeed(false) : Effect.succeed(repo.hasPath(path))

  const writeFileString = (path: string, data: string): Effect.Effect<void, PlatformError> => {
    if (isGitDirPath(path)) return Effect.fail(gitDirNotFound("writeFileString", path))
    repo.writeFile(path, data)
    return Effect.void
  }

  // fallow-ignore-next-line complexity
  const remove = (
    path: string,
    options?: FileSystem.RemoveOptions,
  ): Effect.Effect<void, PlatformError> => {
    if (isGitDirPath(path)) {
      if (options?.force === true) return Effect.void
      return Effect.fail(gitDirNotFound("remove", path))
    }
    if (options?.recursive === true) {
      for (const key of repo.pathsUnder(path)) repo.deleteFile(key)
    } else {
      if (!repo.hasPath(path)) {
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
    // Return the fixed in-memory root — the cwd guard in main.ts checks
    // topLevel === realPath(cwd), and both resolve to `root` here.
    Effect.succeed(root)

  const readDirectory = (path: string): Effect.Effect<Array<string>, PlatformError> =>
    Effect.succeed([...repo.childNames(path)])

  const stat = (path: string): Effect.Effect<FileSystem.File.Info, PlatformError> => {
    const content = repo.readFile(path)
    if (content !== undefined) {
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
        size: FileSystem.Size(BigInt(content.length)),
        blksize: Option.none<FileSystem.Size>(),
        blocks: Option.none<number>(),
      })
    }
    if (repo.hasPath(path)) {
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
// 2. In-memory ConfigService layer — a `ConfigSource` + `FileRefReader` pair
// fed through `Config.ts`'s shared `configServiceLayer`, so an `@inmem`
// scenario runs the SAME parse/merge/decode/compile pipeline production does
// (including `ConfigSchema`'s strict decode), never a bespoke copy.
// ---------------------------------------------------------------------------

/**
 * Scans `SEARCH_PLACES` directly off the fake worktree and returns at most
 * ONE level — a single directory, unlike `nodeConfigSource`'s cwd→home walk
 * (there is no "home directory" concept in the fake). `filepath` is
 * `join(root, name)` so `inlineLevel`'s `dirname(filepath)` lands on `root`,
 * matching production.
 */
const worktreeConfigSource = (repo: InMemRepo, root: string): ConfigSource => ({
  levels: () =>
    Effect.try({
      try: (): ReadonlyArray<ConfigLevel> => {
        for (const name of SEARCH_PLACES) {
          const content = repo.readFile(name)
          if (content !== undefined) {
            return [{ filepath: `${root}/${name}`, config: parseConfigLevel(name, content) }]
          }
        }
        return []
      },
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    }),
})

/**
 * Maps the absolute paths `resolveContent` builds (`join(configDir, ref)`)
 * back to a repo-relative worktree key by stripping `${root}/`, and reports
 * not-exists for anything outside `root` — the honest in-memory semantics (a
 * content file reference can't reach outside the fake's one worktree).
 */
const fileRefReader = (repo: InMemRepo, root: string): FileRefReader => {
  const prefix = `${root}/`
  const relative = (path: string): string | undefined =>
    path.startsWith(prefix) ? path.slice(prefix.length) : undefined
  return {
    exists: (path) => {
      const rel = relative(path)
      return rel !== undefined && repo.hasPath(rel)
    },
    read: (path) => {
      const content = relative(path) !== undefined ? repo.readFile(relative(path)!) : undefined
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`)
      }
      return content
    },
  }
}

const makeInMemoryConfigService = (repo: InMemRepo, root: string): Layer.Layer<ConfigService> =>
  configServiceLayer(worktreeConfigSource(repo, root), root, fileRefReader(repo, root))

// ---------------------------------------------------------------------------
// 3. In-memory WorktreeReader layer
// ---------------------------------------------------------------------------

/** `PatternTemplates.TemplateContext.read` for the in-memory tier: a synchronous lookup straight into the repo's worktree (never real `fs`). */
/** `RepoFiles` for the in-memory tier: a synchronous worktree lookup (never real `fs`) and `committed` via the repo's own `fileAtRef`. Absence is `undefined` on BOTH members — `templateRead` re-adds the ENOENT throw for the one caller (Eta) that needs it. */
const makeInMemoryRepoFiles = (repo: InMemRepo): Layer.Layer<RepoFiles> =>
  Layer.succeed(RepoFiles, {
    working: (path: string) => repo.readFile(path),
    committed: (path: string, ref = "HEAD") =>
      Effect.succeed(repo.fileAtRef(ref, path) ?? undefined),
  })

/** One scripted `bash` command's canned behavior, keyed by the RENDERED command string a scenario's `Given` step declares. */
export type ScriptedCommand =
  | { readonly kind: "exit"; readonly status: number; readonly output: string }
  | { readonly kind: "rewrite"; readonly file: string; readonly content: string }

/**
 * `CommandRunner` for the in-memory tier: real subprocess execution is
 * unreachable against an in-memory worktree, so every command a scenario
 * needs must be declared with a `Given the shell command "<cmd>" ...` step —
 * keyed by the command string AFTER Eta rendering, exactly as `bash` would
 * receive it. An unscripted command fails LOUDLY (never silently succeeds),
 * so a scenario that forgets to declare one fails with a clear message
 * rather than passing by accident.
 */
const makeScriptedCommandRunner = (
  repo: InMemRepo,
  commands: ReadonlyMap<string, ScriptedCommand>,
): Layer.Layer<CommandRunner> =>
  Layer.succeed(CommandRunner, {
    bash: (command: string): Effect.Effect<CommandOutcome, Error> => {
      const scripted = commands.get(command)
      if (scripted === undefined) {
        return Effect.fail(
          new Error(`unscripted command "${command}" — declare it with a Given step`),
        )
      }
      if (scripted.kind === "rewrite") {
        repo.writeFile(scripted.file, scripted.content)
        return Effect.succeed({ status: 0, output: "" })
      }
      return Effect.succeed({ status: scripted.status, output: scripted.output })
    },
  })

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export interface TestWorldOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly root?: string
  /** Canned `bash` outcomes for the scripted `CommandRunner` — see `ScriptedCommand`. */
  readonly commands?: ReadonlyMap<string, ScriptedCommand>
}

/** The fine-grained `GitService` layer alone — for unit tests that need only git. `root` (default `/repo`) is only consumed by `topLevel`/`gitDir` — see `fakeGitOperations`. */
export const gitTestLayer = (repo: InMemRepo, root = "/repo"): Layer.Layer<GitService> =>
  Layer.succeed(GitService, withIndexLockRetries(fakeGitOperations(repo, root)))

/** Every layer `makeProgram` needs — `CommandRequirements`'s return type here IS the guarantee: a new port added there fails this function's typecheck instead of silently under-providing. */
export function testLayers(
  repo: InMemRepo,
  opts: TestWorldOptions = {},
): Layer.Layer<CommandRequirements> {
  const root = opts.root ?? "/repo"
  const fsLayer = Layer.succeed(FileSystem.FileSystem, makeInMemoryFileSystem(repo, root))
  const configLayer = makeInMemoryConfigService(repo, root)

  return Layer.mergeAll(
    gitTestLayer(repo, root),
    fsLayer,
    configLayer,
    Cwd.layer(root),
    makeInMemoryRepoFiles(repo),
    makeScriptedCommandRunner(repo, opts.commands ?? new Map()),
    EnvVars.layer(opts.env ?? {}),
  )
}
