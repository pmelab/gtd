// `testLayers` is the ONE layer-set builder every `@inmem` scenario and
// `src/**/*.test.ts` unit test provides.
//
// gtd itself spawns no subprocess at all any more (`gtd renders; the driver
// executes`) — a mode's `format:`/`validate:` command is emitted text, never
// run in-process. `ScriptedCommand` below still exists for the world's own
// fake-shell interpreter (`src/testing/EmittedScriptRecognizer.ts`), which
// simulates a driver running gtd's emitted scripts against the in-memory
// worktree — a wholly separate mechanism from any gtd-internal layer.

import { FileSystem } from "@effect/platform"
import { Effect, Layer } from "effect"
import { isAbsolute, join } from "node:path"
import { parse as parseYaml } from "yaml"
import { GtdError, Narrator } from "../Commentary.js"
import { ConfigDiscovery, ConfigService, SEARCH_PLACES, walkUp } from "../workflow/index.js"
import { GitService, Host, Workspace, type WorkspaceOps } from "../platform/index.js"
import { fakeGitOperations } from "./FakeGitOperations.js"
import { CommandRunner } from "../CommandRunner.js"
import { UiListener } from "../ui/Server.js"
import { InMemRepo } from "./InMemRepo.js"
import type { CommandRequirements } from "../program.js"

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
 * every existing scenario already seeds the fake (`repo.writeFile(".gtdrc.yaml",
 * …)`, `repo.writeFile("src/a.ts", …)`). // gtd-path-exempt: illustrative fixture key, not a repo file
 * `atPath` alone accepts an absolute
 * path: one rooted under `root` maps to its relative key (an already-absolute
 * content file-ref resolved via `resolvePath`); one OUTSIDE root (an ancestor
 * `.gtdrc`, exercising `directoryChainConfig`) is used as the literal key
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

/** Deliberately NOT shared with `ConfigDiscovery.Live`: `yaml`/`JSON.parse` here, cosmiconfig's own bundled loaders there — see `Layers.test.ts` for the one pinned divergence this causes. */
const parseConfigLevel = (filepath: string, content: string): unknown => {
  const result: unknown = filepath.endsWith(".json") ? JSON.parse(content) : parseYaml(content)
  if (result === null) {
    throw new Error(`${filepath}: config must be a plain object, got null`)
  }
  return result
}

/** The in-memory counterpart to `ConfigDiscovery.Live` (`src/workflow/discovery.ts`) — shares its `SEARCH_PLACES`/`walkUp` exactly (see `Layers.test.ts`), reading through the fake `Workspace` instead of real `fs`. */
const makeInMemoryConfigDiscovery = (
  repo: InMemRepo,
  root: string,
): Layer.Layer<ConfigDiscovery> => {
  const workspace = makeInMemoryWorkspaceOps(repo, root)
  const findAt = (
    dir: string,
  ): { readonly filepath: string; readonly config: unknown } | undefined => {
    for (const name of SEARCH_PLACES) {
      const filepath = join(dir, name)
      const content = workspace.atPath(filepath)
      if (content === undefined || content.trim() === "") continue
      return { filepath, config: parseConfigLevel(filepath, content) }
    }
    return undefined
  }
  return Layer.succeed(ConfigDiscovery, {
    // `walkUp` returns innermost→outermost; reversed so merging in order
    // makes innermost win — same as `ConfigDiscovery.Live`.
    levels: (levelRoot, levelHome) =>
      Effect.try({
        try: () =>
          [...walkUp(levelRoot, levelHome)]
            .reverse()
            .map(findAt)
            .filter((level): level is { filepath: string; config: unknown } => level !== undefined),
        catch: toError,
      }),
    presentAt: (dir) => Effect.try({ try: () => findAt(dir) !== undefined, catch: toError }),
  })
}

/** One scripted `bash` command's canned behavior, keyed by the RENDERED command string a scenario's `Given` step declares. */
export type ScriptedCommand =
  | { readonly kind: "exit"; readonly status: number; readonly output: string }
  | { readonly kind: "rewrite"; readonly file: string; readonly content: string }

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
  /** Gates `narrate` above — defaults to `true` (fires whenever a sink is given) since these tests aren't exercising `Cli.ts`'s own `--verbose` gate. `src/testing/cliIo.ts` overrides this with the real decoded flag. */
  readonly verbose?: boolean
}

/** The fine-grained `GitService` layer alone — for unit tests that need only git. */
export const gitTestLayer = (repo: InMemRepo, root = "/repo"): Layer.Layer<GitService> =>
  Layer.succeed(GitService, fakeGitOperations(repo, root))

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
    Host.layer({ root, home, env: opts.env ?? {}, realPath: () => Effect.succeed(root) }),
    ConfigService.Live,
    makeInMemoryConfigDiscovery(repo, root),
    Narrator.layer(opts.narrate ?? (() => {}), opts.verbose ?? true),
    // No `@inmem`/direct-Effect test binds a real socket — `gtd ui`
    // itself is unit-tested in `src/ui/Server.test.ts` with its own fake
    // `UiListener`. A call reaching this one is a test gap, not silence.
    Layer.succeed(UiListener, {
      listen: () =>
        Effect.fail(new GtdError("gtd ui: UiListener has no test double wired into testLayers()")),
    }),
    // `gtd ui`'s two remaining ports, for the same reason and with the same
    // loudness: the only `@inmem` scenarios that reach `gtd ui` refuse at a
    // guard BEFORE either is touched (see `tests/integration/features/
    // ui.feature`), and everything past that guard is unit-tested in
    // `src/ui/**` against its own doubles. Reaching one of these is a test
    // gap, not silence — gtd itself spawns no subprocess any more, so there
    // is deliberately no scripted-command double to fall back on.
    CommandRunner.layer(() =>
      Effect.fail(new Error("gtd ui: CommandRunner has no test double wired into testLayers()")),
    ),
    Layer.succeed(FileSystem.FileSystem, FileSystem.makeNoop({})),
  )
}
