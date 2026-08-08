/**
 * In-memory Effect layers backed by InMemRepo for integration tests.
 * No real filesystem or git is used.
 */

import { FileSystem } from "@effect/platform"
import { SystemError, type PlatformError } from "@effect/platform/Error"
import { Effect, Layer, Option } from "effect"
import { parse as parseYaml } from "yaml"
import {
  GitService,
  type GitReaderOperations,
  type GitWriterOperations,
  type GitOperations,
} from "../../../../src/Git.js"
import { ConfigService, type ConfigOperations } from "../../../../src/Config.js"
import {
  compileModesMap,
  compileVarsMap,
  compileWorkflowConfig,
  mergeModes,
} from "../../../../src/PatternConfig.js"
import {
  defaultMachineTree,
  defaultStateScopes,
  defaultWorkflowDefinition,
  defaultWorkflowVars,
} from "../../../../src/workflows/templates.js"
import { InMemRepo } from "./Repo.js"
import { Cwd } from "../../../../src/Cwd.js"
import { EnvVars } from "../../../../src/EnvVars.js"
import { WorktreeReader } from "../../../../src/WorktreeReader.js"
import { CommandRunner, type CommandOutcome } from "../../../../src/CommandRunner.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tryCatch = <A>(fn: () => A): Effect.Effect<A, Error> =>
  Effect.try({
    try: fn,
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

// ---------------------------------------------------------------------------
// 1. GitReader.InMemory
// ---------------------------------------------------------------------------

const makeGitReaderOps = (repo: InMemRepo): GitReaderOperations => ({
  hasCommits: () => Effect.succeed(repo.hasCommits()),

  lastCommitSubject: (ref?: string) => {
    const subject = repo.lastCommitSubject(ref)
    return subject !== null ? Effect.succeed(subject) : Effect.fail(new Error("No commits"))
  },

  lastCommitMessage: () => {
    const message = repo.lastCommitMessage()
    return message !== null ? Effect.succeed(message) : Effect.fail(new Error("No commits"))
  },

  resolveRef: (ref: string) => {
    const hash = repo.resolveRef(ref)
    return hash !== null
      ? Effect.succeed(hash)
      : Effect.fail(new Error(`Cannot resolve ref: ${ref}`))
  },

  readFileAtRef: (ref: string, path: string) => {
    const content = repo.fileAtRef(ref, path)
    return content !== null
      ? Effect.succeed(content)
      : Effect.fail(new Error(`path not found at ${ref}: ${path}`))
  },

  readRefOption: (ref: string) => {
    const hash = repo.resolveRef(ref)
    return Effect.succeed(hash !== null ? Option.some(hash) : Option.none<string>())
  },

  isAncestor: (a: string, b: string) => Effect.succeed(repo.isAncestor(a, b)),

  topLevel: () => Effect.succeed("/repo"),

  commitHistory: (base?: string) => Effect.succeed(repo.commitHistory(base)),

  changedPaths: () => Effect.succeed(repo.changedPathsWorktree()),

  changedPathsSince: (ref: string) =>
    tryCatch(() => {
      if (repo.resolveRef(ref) === null) {
        throw new Error(`Cannot resolve ref: ${ref}`)
      }
      return repo.changedPathsBetween(ref, "HEAD")
    }),
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

  hardResetTo: (ref: string) => tryCatch(() => repo.hardResetTo(ref)),

  restoreStagedFrom: (source: string, paths: ReadonlyArray<string>) =>
    tryCatch(() => repo.restoreStagedFrom(source, paths)),
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

/** Mirrors the real `Config.ts`'s `compileRcModes`: the top-level `.gtdrc` `modes:` key, through the SAME `compileModesMap`, layered over the active workflow's own modes. */
const compileRcModes = (raw: unknown) => {
  const errors: string[] = []
  const modes = compileModesMap(raw, errors)
  if (errors.length > 0) {
    throw new Error(`gtd config:\n${errors.map((e) => `  - ${e}`).join("\n")}`)
  }
  return modes
}

/**
 * Mirrors the real `ConfigService.Live`'s `toOperations`: an absent
 * `workflow:` key falls back to gtd's built-in bundled default
 * (`defaultWorkflowDefinition`, with the top-level `modes:` layered over it);
 * a present one is compiled through the SAME `compileWorkflowConfig` the real
 * service uses — no bespoke in-memory workflow interpretation. Likewise the
 * top-level `vars:` key goes through the same `compileRcVars` the real service
 * uses. `configDir` is `"/repo"` (this harness's fixed in-memory root, matching
 * `topLevel`/`realPath` above) so a scenario's custom workflow could reference
 * `./`-relative content if it ever needed to (none currently do; every @inmem
 * custom-workflow scenario writes inline content).
 */
const makeConfigOps = (raw: Record<string, unknown>): ConfigOperations => {
  const rcVars = compileRcVars(raw["vars"])
  const rcModes = compileRcModes(raw["modes"])
  if (raw["workflow"] === undefined) {
    const modes = mergeModes(defaultWorkflowDefinition.modes, rcModes)
    return {
      workflow:
        modes !== undefined ? { ...defaultWorkflowDefinition, modes } : defaultWorkflowDefinition,
      workflowVars: defaultWorkflowVars,
      rcVars,
      machineTree: defaultMachineTree,
      stateScopes: defaultStateScopes,
    }
  }
  const {
    definition,
    vars: workflowVars,
    tree,
    scopes,
  } = compileWorkflowConfig(raw["workflow"], "/repo", rcModes)
  return { workflow: definition, workflowVars, rcVars, machineTree: tree, stateScopes: scopes }
}

const makeInMemoryConfigService = (repo: InMemRepo): Layer.Layer<ConfigService> => {
  const worktree = (repo as unknown as { worktree: Map<string, string> })["worktree"]

  // Deferred exactly like the real `ConfigService.Live`: `load` (re)reads the
  // worktree config on each access and falls back to the built-in default when
  // no `workflow:` is present, so building the layer never fails and
  // config-independent commands (`init`) run with no config in the worktree.
  const load = Effect.try({
    try: (): ConfigOperations => {
      for (const name of SEARCH_PLACES) {
        const content = worktree.get(name)
        if (content !== undefined) {
          const raw = parseConfigContent(name, content)
          return makeConfigOps(raw)
        }
      }
      return makeConfigOps({})
    },
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  })

  return Layer.succeed(ConfigService, { load })
}

// ---------------------------------------------------------------------------
// 4b. Recording CommandRunner layer
// ---------------------------------------------------------------------------

/** One recorded call into a `RecordingCommandRunner`. */
export interface RecordedCommand {
  readonly command: string
  readonly cwd: string
}

/**
 * A `CommandRunner` test double: records every call it receives and answers
 * with a scriptable outcome (default `{ status: 0, output: "" }`) — no real
 * subprocess, matching the `@inmem` tier's "no real filesystem or git" rule.
 * `@inmem` scenarios don't currently exercise a mode's `format:`/`validate:`
 * command (those live in `@live` `steering-modes.feature`, run against the
 * real `bin/gtd` binary), so this default is rarely hit — it exists so
 * `inMemoryLayers` satisfies `CommandRunner`'s presence in `ProgramRequirements`
 * without a real shell, and so a FUTURE `@inmem` scenario can script an
 * outcome via `setOutcome`.
 */
export interface RecordingCommandRunner {
  readonly layer: Layer.Layer<CommandRunner>
  readonly calls: readonly RecordedCommand[]
  readonly setOutcome: (outcome: CommandOutcome) => void
}

export const makeRecordingCommandRunner = (): RecordingCommandRunner => {
  const calls: RecordedCommand[] = []
  let outcome: CommandOutcome = { status: 0, output: "" }
  return {
    layer: CommandRunner.layer((command, cwd) => {
      calls.push({ command, cwd })
      return Effect.succeed(outcome)
    }),
    calls,
    setOutcome: (next) => {
      outcome = next
    },
  }
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
  | GitService
  | FileSystem.FileSystem
  | ConfigService
  | Cwd
  | WorktreeReader
  | EnvVars
  | CommandRunner
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
    Cwd.layer("/repo"),
    makeInMemoryWorktreeReader(repo),
    EnvVars.layer(env),
    makeRecordingCommandRunner().layer,
  )
}

// Fine-grained layer for unit tests that need only the git service.
export const makeGitServiceLayer = (repo: InMemRepo): Layer.Layer<GitService> =>
  Layer.succeed(GitService, {
    ...makeGitReaderOps(repo),
    ...makeGitWriterOps(repo),
  })
