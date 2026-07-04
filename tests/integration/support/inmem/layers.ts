/**
 * In-memory Effect layers backed by InMemRepo for integration tests.
 * No real filesystem or git is used.
 */

import { FileSystem } from "@effect/platform"
import { SystemError, type PlatformError } from "@effect/platform/Error"
import { Effect, Layer, Option } from "effect"
import { parse as parseYaml } from "yaml"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { renderDiff } from "../../../../src/Diff.js"
import {
  GitReader,
  GitWriter,
  GitService,
  type GitReaderOperations,
  type GitWriterOperations,
  type GitOperations,
} from "../../../../src/Git.js"
import { TestRunner, type TestResult } from "../../../../src/TestRunner.js"
import {
  ConfigService,
  type ConfigOperations,
  builtinTierDefault,
  stateTier,
  type ModelState,
} from "../../../../src/Config.js"
import { InMemRepo } from "./Repo.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tryCatch = <A>(fn: () => A): Effect.Effect<A, Error> =>
  Effect.try({ try: fn, catch: (e) => (e instanceof Error ? e : new Error(String(e))) })

/**
 * Write all files from an in-memory worktree into a real temp directory.
 * Used so bash scripts can reference worktree files by path.
 */
function populateTempDir(tmpDir: string, worktree: Map<string, string>): void {
  for (const [filePath, content] of worktree) {
    const full = join(tmpDir, filePath)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
}

/**
 * Execute a bash script from the worktree in a temp directory populated
 * with all worktree files, so the script can reference sibling files.
 */
function runBashScript(
  scriptPath: string,
  worktree: Map<string, string>,
): { exitCode: number; output: string } | null {
  const scriptContent = worktree.get(scriptPath)
  if (scriptContent === undefined) return null
  const tmpDir = mkdtempSync(join(tmpdir(), "gtd-test-"))
  try {
    populateTempDir(tmpDir, worktree)
    const scriptFile = join(tmpDir, scriptPath)
    writeFileSync(scriptFile, scriptContent, { mode: 0o755 })
    const result = spawnSync("bash", [scriptFile], {
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: 10_000,
    })
    return {
      exitCode: result.status ?? 1,
      output: (result.stdout ?? "") + (result.stderr ?? ""),
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
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

      const filtered =
        exclude.length === 0
          ? allPaths
          : allPaths.filter(({ path }) => {
              for (const ex of exclude) {
                if (path === ex || path.startsWith(`${ex}/`)) return false
              }
              return true
            })

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

      const filtered =
        exclude.length === 0
          ? allPaths
          : allPaths.filter(({ path }) => {
              for (const ex of exclude) {
                if (path === ex || path.startsWith(`${ex}/`)) return false
              }
              return true
            })

      if (filtered.length === 0) return ""

      const files = filtered.map(({ path, status }) => {
        const before = status === "A" ? null : (repo.fileAtRef(ref, path) ?? null)
        const after = status === "D" ? null : (repo.fileAtRef("HEAD", path) ?? null)
        return { path, before, after }
      })

      return renderDiff(files)
    }),

  diffPath: (path: string) =>
    Effect.sync(() => {
      const before = repo.fileAtRef("HEAD", path)
      const after = repo["worktree"].get(path) ?? null

      if (before === null && after === null) return ""
      if (before === after) return ""

      return renderDiff([{ path, before, after }])
    }),
})

// ---------------------------------------------------------------------------
// 2. GitWriter.InMemory
// ---------------------------------------------------------------------------

const makeGitWriterOps = (repo: InMemRepo): GitWriterOperations => ({
  commitAllWithPrefix: (prefix: string) => tryCatch(() => repo.commitAllWithPrefix(prefix)),

  softResetTo: (ref: string) => tryCatch(() => repo.softResetTo(ref)),

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

  const remove = (
    path: string,
    options?: FileSystem.RemoveOptions,
  ): Effect.Effect<void, PlatformError> => {
    const worktree = getWorktree()
    if (options?.recursive === true) {
      const prefix = path.endsWith("/") ? path : `${path}/`
      for (const key of [...worktree.keys()]) {
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
// 4. In-memory TestRunner layer
// ---------------------------------------------------------------------------

const _makeInMemoryTestRunner = (
  _repo: InMemRepo,
): { run: () => Effect.Effect<TestResult, Error> } => ({
  run: (): Effect.Effect<TestResult, Error> =>
    Effect.fail(
      new Error(
        "TestRunner.InMemory.run() called without a configured testCommand. " +
          "Provide a TestRunner layer with the specific command your test needs.",
      ),
    ),
})

/**
 * Build an in-memory TestRunner layer for a specific command string.
 * Recognizes:
 *   "true"         → exitCode: 0
 *   "false"        → exitCode: 1
 *   "test -f <p>"  → exitCode: 0 if path exists in worktree, 1 otherwise
 *   any other      → throws Error (unrecognized command)
 */
export const makeTestRunnerForCommand = (
  repo: InMemRepo,
  command: string,
): Layer.Layer<TestRunner> => {
  const worktreeHasPath = (path: string): boolean => {
    const worktree = (repo as unknown as { worktree: Map<string, string> })["worktree"]
    return worktree.has(path)
  }

  const run = (): Effect.Effect<TestResult, Error> => {
    const cmd = command.trim()

    if (cmd === "true") {
      return Effect.succeed({ exitCode: 0, output: "" })
    }
    if (cmd === "false") {
      return Effect.succeed({ exitCode: 1, output: "" })
    }

    // test -f <path>
    const testFMatch = /^test -f (.+)$/.exec(cmd)
    if (testFMatch !== null) {
      const path = testFMatch[1]!.trim()
      return Effect.succeed({ exitCode: worktreeHasPath(path) ? 0 : 1, output: "" })
    }

    // bash -c 'test -f <path>'
    const bashTestFMatch = /^bash -c 'test -f (.+)'$/.exec(cmd)
    if (bashTestFMatch !== null) {
      const path = bashTestFMatch[1]!.trim()
      return Effect.succeed({ exitCode: worktreeHasPath(path) ? 0 : 1, output: "" })
    }

    // bash <script.sh>
    const bashScriptMatch = /^bash\s+(\S+)$/.exec(cmd)
    if (bashScriptMatch !== null) {
      const scriptPath = bashScriptMatch[1]!.trim()
      const worktree = (repo as unknown as { worktree: Map<string, string> })["worktree"]
      const result = runBashScript(scriptPath, worktree)
      if (result === null) {
        return Effect.succeed({
          exitCode: 1,
          output: `bash: ${scriptPath}: No such file or directory\n`,
        })
      }
      return Effect.succeed(result)
    }

    // Unknown command → simulate ENOENT
    return Effect.fail(new Error(`test command not found: ${cmd}`))
  }

  return Layer.succeed(TestRunner, { run })
}

// ---------------------------------------------------------------------------
// 5. In-memory ConfigService layer
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

const makeConfigOps = (raw: Record<string, unknown>): ConfigOperations => {
  const testCommand = typeof raw["testCommand"] === "string" ? raw["testCommand"] : "npm run test"
  const agenticReview = typeof raw["agenticReview"] === "boolean" ? raw["agenticReview"] : true
  const squash = typeof raw["squash"] === "boolean" ? raw["squash"] : true
  const fixAttemptCap = typeof raw["fixAttemptCap"] === "number" ? raw["fixAttemptCap"] : 3
  const reviewThreshold = typeof raw["reviewThreshold"] === "number" ? raw["reviewThreshold"] : 3

  const modelsRaw = raw["models"]
  const models =
    modelsRaw !== null && typeof modelsRaw === "object" && !Array.isArray(modelsRaw)
      ? (modelsRaw as Record<string, unknown>)
      : {}

  const resolveModel = (state: ModelState): string => {
    const statesRaw = models["states"]
    if (statesRaw !== null && typeof statesRaw === "object" && !Array.isArray(statesRaw)) {
      const stateOverride = (statesRaw as Record<string, unknown>)[state]
      if (typeof stateOverride === "string") return stateOverride
    }
    const tier = stateTier[state]
    const tierKey = tier === "planning" ? "planning" : "execution"
    const tierOverride = models[tierKey]
    if (typeof tierOverride === "string") return tierOverride
    return builtinTierDefault[tier]
  }

  return { testCommand, resolveModel, agenticReview, squash, fixAttemptCap, reviewThreshold }
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
// Assembly
// ---------------------------------------------------------------------------

export function inMemoryLayers(
  repo: InMemRepo,
): Layer.Layer<GitService | FileSystem.FileSystem | TestRunner | ConfigService> {
  // Reader + Writer share the same repo instance
  const readerOps = makeGitReaderOps(repo)
  const writerOps = makeGitWriterOps(repo)
  const gitOps: GitOperations = { ...readerOps, ...writerOps }

  const gitServiceLayer = Layer.succeed(GitService, gitOps)

  const fsLayer = Layer.succeed(FileSystem.FileSystem, makeInMemoryFileSystem(repo))

  const configLayer = makeInMemoryConfigService(repo)

  // Default TestRunner — reads testCommand from config and routes through the
  // recognizing runner (true / false / test -f <path>). Fails loudly on unknown commands.
  const testRunnerLayer = Layer.effect(
    TestRunner,
    Effect.gen(function* () {
      const config = yield* ConfigService
      const worktreeHasPath = (path: string): boolean => {
        const worktree = (repo as unknown as { worktree: Map<string, string> })["worktree"]
        return worktree.has(path)
      }
      const run = (): Effect.Effect<TestResult, Error> => {
        const cmd = config.testCommand.trim()
        if (cmd === "true") return Effect.succeed({ exitCode: 0, output: "" })
        if (cmd === "false") return Effect.succeed({ exitCode: 1, output: "" })
        const testFMatch = /^test -f (.+)$/.exec(cmd)
        if (testFMatch !== null) {
          const path = testFMatch[1]!.trim()
          return Effect.succeed({ exitCode: worktreeHasPath(path) ? 0 : 1, output: "" })
        }
        const bashTestFMatch = /^bash -c 'test -f (.+)'$/.exec(cmd)
        if (bashTestFMatch !== null) {
          const path = bashTestFMatch[1]!.trim()
          return Effect.succeed({ exitCode: worktreeHasPath(path) ? 0 : 1, output: "" })
        }
        // bash <script.sh>
        const bashScriptMatch = /^bash\s+(\S+)$/.exec(cmd)
        if (bashScriptMatch !== null) {
          const scriptPath = bashScriptMatch[1]!.trim()
          const worktree = (repo as unknown as { worktree: Map<string, string> })["worktree"]
          const result = runBashScript(scriptPath, worktree)
          if (result === null) {
            return Effect.succeed({
              exitCode: 1,
              output: `bash: ${scriptPath}: No such file or directory\n`,
            })
          }
          return Effect.succeed(result)
        }
        // Unknown command → simulate ENOENT
        return Effect.fail(new Error(`test command not found: ${cmd}`))
      }
      return { run }
    }),
  ).pipe(Layer.provide(configLayer))

  return Layer.mergeAll(gitServiceLayer, fsLayer, testRunnerLayer, configLayer)
}

// Also export individual layers for fine-grained composition
export const makeGitReaderLayer = (repo: InMemRepo): Layer.Layer<GitReader> =>
  Layer.succeed(GitReader, makeGitReaderOps(repo))

export const makeGitWriterLayer = (repo: InMemRepo): Layer.Layer<GitWriter> =>
  Layer.succeed(GitWriter, makeGitWriterOps(repo))

export const makeGitServiceLayer = (repo: InMemRepo): Layer.Layer<GitService> =>
  Layer.succeed(GitService, { ...makeGitReaderOps(repo), ...makeGitWriterOps(repo) })

export const makeFileSystemLayer = (repo: InMemRepo): Layer.Layer<FileSystem.FileSystem> =>
  Layer.succeed(FileSystem.FileSystem, makeInMemoryFileSystem(repo))

export const makeConfigLayer = (repo: InMemRepo): Layer.Layer<ConfigService> =>
  makeInMemoryConfigService(repo)
