// `testLayers` is the ONE layer-set builder every `@inmem` scenario and
// `src/**/*.test.ts` unit test provides.
//
// gtd itself spawns no subprocess at all any more (`gtd renders; the driver
// executes`) — a mode's `format:`/`validate:` command is emitted text, never
// run in-process. `ScriptedCommand` below still exists for the world's own
// fake-shell interpreter (`src/testkit/EmittedScriptRecognizer.ts`), which
// simulates a driver running gtd's emitted scripts against the in-memory
// worktree — a wholly separate mechanism from any gtd-internal layer.

import { Effect, Layer } from "effect"
import { isAbsolute, join } from "node:path"
import {
  Narrator,
  GitService,
  Host,
  Workspace,
  type WorkspaceOps,
  CommandRunner,
} from "../platform/index.js"
import {
  ConfigDiscovery,
  ConfigService,
  LEGACY_RC_FILES,
  legacyRcDirs,
  WORKFLOW_MODULE,
  walkUp,
} from "../workflow/index.js"
import { fakeGitOperations } from "./FakeGitOperations.js"
import { InMemRepo } from "./InMemRepo.js"

// Read off the CLI's own port rather than imported from the composition root.
type CommandRequirements = Layer.Layer.Success<ReturnType<CliIo["layers"]>>
import { ToolCommands, type CliIo } from "../cli/index.js"

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)))

/**
 * Keys UNDER `.git/` (never the bare `.git` FILE itself — `WorktreeState.ts`'s
 * `worktreeGitDir` legitimately reads that one, a linked worktree's real
 * gitdir-pointer file) have no production consumer through `Workspace` — gtd
 * keeps no driver-scoped files inside the git dir (sessions are derived,
 * stall is history) — so a stray read/write there FAILS/reads-absent rather
 * than silently falling through to the worktree store, which would make it
 * surface as a pending change (real git never reports a `.git/**` path as
 * one). Mirrors the guard the deleted `makeInMemoryFileSystem` carried.
 */
const isGitDirKey = (key: string): boolean => key.startsWith(".git/")

/**
 * `Workspace` for the in-memory tier. `readSync`/`read`/`write`/`committed`
 * take a repo-relative key ONLY (mirroring the live adapter's
 * `assertRepoRelative` — `Workspace.ts`'s `makeWorkspaceOps`), matching how
 * every existing scenario already seeds the fake (`repo.writeFile("gtd.config.ts",
 * …)`, `repo.writeFile("src/a.ts", …)`). // gtd-path-exempt: illustrative fixture key, not a repo file
 * `atPath` alone accepts an absolute
 * path: one rooted under `root` maps to its relative key (an already-absolute
 * content file-ref resolved via `resolvePath`); one OUTSIDE root (an ancestor
 * `gtd.config.ts`, or a leftover rc file in home) is used as the literal key
 * verbatim, so a test seeds it exactly as given:
 * `repo.writeFile("/home/user/.gtdrc", …)`.
 */
export const makeInMemoryWorkspaceOps = (repo: InMemRepo, root: string): WorkspaceOps => {
  const toKey = (path: string): string => {
    if (!isAbsolute(path)) return path
    const prefix = `${root}/`
    return path === root ? "" : path.startsWith(prefix) ? path.slice(prefix.length) : path
  }
  const assertRepoRelative = (path: string): string => {
    if (isAbsolute(path)) {
      throw new Error(
        `Workspace: "${path}" is an absolute path — this member takes repo-relative paths only (use "atPath" to read outside the repo)`,
      )
    }
    return path
  }
  const readAt = (key: string): string | undefined =>
    isGitDirKey(key) ? undefined : repo.readFile(key)

  const readSync = (path: string): string | undefined => readAt(assertRepoRelative(path))

  const treeOf = (ref: string): ReadonlyMap<string, string> =>
    new Map(repo.pathsAtRef(ref).map((path) => [path, repo.fileAtRef(ref, path) ?? ""]))

  return {
    readSync,
    read: (path) => Effect.try({ try: () => readSync(path), catch: toError }),
    write: (path, content) =>
      Effect.try({
        try: () => {
          const key = assertRepoRelative(path)
          if (isGitDirKey(key)) {
            throw new Error(`ENOENT: no such file or directory, open '${path}'`)
          }
          repo.writeFile(key, content)
        },
        catch: toError,
      }),
    committed: (path, ref = "HEAD") =>
      Effect.try({ try: () => assertRepoRelative(path), catch: toError }).pipe(
        Effect.map((key) =>
          isGitDirKey(key) ? undefined : (repo.fileAtRef(ref, key) ?? undefined),
        ),
      ),
    readCommittedSync: (path, ref = "HEAD") => {
      const key = assertRepoRelative(path)
      return isGitDirKey(key) ? undefined : (repo.fileAtRef(ref, key) ?? undefined)
    },
    treeSync: treeOf,
    // No subprocess, no cache to warm — the in-memory fake reads its
    // `InMemRepo` directly for each hash, same as `treeSync` above.
    episodeTrees: (base, commits) =>
      Effect.succeed(
        new Map([...(base !== undefined ? [base] : []), ...commits].map((h) => [h, treeOf(h)])),
      ),
    worktreeSync: () =>
      new Map(
        repo
          .pathsUnder("")
          .filter((path) => !isGitDirKey(path))
          .map((path) => [path, repo.readFile(path)]),
      ),
    atPath: (path) => readAt(toKey(path)),
    writeAtPath: (path, content) =>
      Effect.try({
        try: () => {
          const key = toKey(path)
          if (isGitDirKey(key)) {
            throw new Error(`ENOENT: no such file or directory, open '${path}'`)
          }
          repo.writeFile(key, content)
        },
        catch: toError,
      }),
  }
}

/** The in-memory counterpart to `ConfigDiscovery.Live` (`src/workflow/discovery.ts`) — shares its `LEGACY_RC_FILES`/`legacyRcDirs`/`walkUp` exactly (see `Layers.test.ts`), reading through the fake `Workspace` instead of real `fs`. */
const makeInMemoryConfigDiscovery = (
  repo: InMemRepo,
  root: string,
): Layer.Layer<ConfigDiscovery> => {
  const workspace = makeInMemoryWorkspaceOps(repo, root)
  return Layer.succeed(ConfigDiscovery, {
    legacyRcFiles: (levelRoot, levelHome) =>
      Effect.try({
        try: () =>
          legacyRcDirs(levelRoot, levelHome).flatMap((dir) =>
            LEGACY_RC_FILES.map((name) => join(dir, name))
              .filter((filepath) => workspace.atPath(filepath) !== undefined)
              .map((path) => ({ path, owned: true })),
          ),
        catch: toError,
      }),
    workflowModule: (levelRoot, levelHome) =>
      Effect.try({
        try: () => {
          for (const dir of walkUp(levelRoot, levelHome)) {
            const filepath = join(dir, WORKFLOW_MODULE)
            const source = workspace.atPath(filepath)
            if (source !== undefined) return { filepath, source, read: workspace.atPath }
          }
          return undefined
        },
        catch: toError,
      }),
  })
}

/** One scripted `bash` command's canned behavior, keyed by the RENDERED command string a scenario's `Given` step declares. */
export type ScriptedCommand =
  | { readonly kind: "exit"; readonly status: number; readonly output: string }
  | {
      readonly kind: "rewrite"
      readonly file: string
      readonly content: string
      /** Adds `content` to the file's end instead of replacing it. */
      readonly append?: boolean
    }
  /** Keyed by the binary's name: it is not on `$PATH`. */
  | { readonly kind: "missing" }

export interface TestWorldOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly root?: string
  /** Defaults to `root` — a real cwd→home chain has no natural counterpart in the fake, so a test not exercising it sees exactly one config level, same as before. */
  readonly home?: string
  /**
   * Captures every narrated line — absent (the default) means the
   * `Narrator` this builds is a no-op, exactly like a real invocation with no
   * `--verbose`. A test asserting on narration passes its own sink here and
   * gets every line regardless of `verbose` (see `verbose` below) — a direct
   * Effect test has no `--verbose` flag of its own to gate on.
   */
  readonly narrate?: (line: string) => void
  /** Gates `narrate` above — defaults to `true` (fires whenever a sink is given) since these tests aren't exercising `Cli.ts`'s own `--verbose` gate. `src/testkit/cliIo.ts` overrides this with the real decoded flag. */
  readonly verbose?: boolean
  /** Real or fake driver and tool commands — each one left out fails when called. */
  readonly tools?: Partial<ToolCommands["Type"]>
}

const missingTool = (name: string) => () =>
  Effect.fail(new Error(`gtd ${name}: ToolCommands has no test double wired into testLayers()`))

const missingToolCommands: ToolCommands["Type"] = {
  ui: missingTool("ui"),
  lsp: missingTool("lsp"),
  loop: missingTool("loop"),
  contextHook: missingTool("context-hook"),
  judge: () =>
    Promise.reject(
      new Error("gtd judge run: ToolCommands has no test double wired into testLayers()"),
    ),
}

/** The fine-grained `GitService` layer alone — for unit tests that need only git. */
export const gitTestLayer = (repo: InMemRepo, root = "/repo"): Layer.Layer<GitService> =>
  Layer.succeed(GitService, fakeGitOperations(repo, root))

/**
 * The one sanctioned leak of the real `process.env` into the in-memory `Host`:
 * the runner's `GTD_FLAG_*` state, so a flag-on `npm test` state exercises the
 * flag in memory as it does live. A test asserting one flag side sets the flag
 * itself; explicit env wins.
 */
export const ambientFlagEnv = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter(
      (e): e is [string, string] => e[0].startsWith("GTD_FLAG_") && e[1] !== undefined,
    ),
  )

/** Every layer `makeProgram` needs — `CommandRequirements`'s return type here IS the guarantee: a new port added there fails this function's typecheck instead of silently under-providing. */
export function testLayers(
  repo: InMemRepo,
  opts: TestWorldOptions = {},
): Layer.Layer<CommandRequirements> {
  const root = opts.root ?? "/repo"
  const home = opts.home ?? root

  return Layer.mergeAll(
    gitTestLayer(repo, root),
    Layer.succeed(Workspace, makeInMemoryWorkspaceOps(repo, root)),
    // `realPath` is a no-op here (there is no real filesystem to resolve
    // symlinks against): both sides of `assertRunningFromRepoRoot`'s
    // comparison collapse to `root` when given anything, exactly like the
    // fake's `root` "resolving" to itself before this port existed.
    Host.layer({
      root,
      home,
      env: { ...ambientFlagEnv(), ...opts.env },
      realPath: () => Effect.succeed(root),
    }),
    ConfigService.Live,
    makeInMemoryConfigDiscovery(repo, root),
    Narrator.layer(opts.narrate ?? (() => {}), opts.verbose ?? true),
    // Drivers and tools are unit-tested in their own folders; a call reaching
    // one of these is a test gap, not silence. A test opts into one via `tools`.
    Layer.succeed(ToolCommands, { ...missingToolCommands, ...opts.tools }),
    // The only `@inmem` scenarios that reach `gtd ui` refuse at a guard before
    // its shell is touched (see `tests/integration/features/ui.feature`) — and
    // gtd itself spawns no subprocess any more, so there is deliberately no
    // scripted-command double to fall back on.
    CommandRunner.layer(() =>
      Effect.fail(new Error("gtd ui: CommandRunner has no test double wired into testLayers()")),
    ),
  )
}
