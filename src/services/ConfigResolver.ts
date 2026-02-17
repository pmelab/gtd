import { Effect, Schema } from "effect"
import { access, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { cosmiconfig } from "cosmiconfig"

import type { GtdConfig } from "./Config.js"
import { GtdConfigSchema } from "./ConfigSchema.js"

export const SCHEMA_URL =
  "https://raw.githubusercontent.com/pmelab/gtd/main/schema.json"

export const EXAMPLE_CONFIG = {
  $schema: SCHEMA_URL,
  _comment:
    "This is an example config. You can move this file to ~/.config/gtd/ or any other supported location.",
  file: "TODO.md",
  agent: "auto",
  testCmd: "npm test",
  testRetries: 10,
  agentInactivityTimeout: 300,
}

export const createExampleConfig = (
  cwd: string,
): Effect.Effect<{ filepath: string; message: string } | null, never> =>
  Effect.tryPromise({
    try: async () => {
      await access(cwd)
      const filepath = join(cwd, ".gtdrc.json")
      const content = JSON.stringify(EXAMPLE_CONFIG, null, 2) + "\n"
      await writeFile(filepath, content, "utf-8")
      const message = `Created example config at .gtdrc.json — you can move it to ~/.config/gtd/ or any other supported location.`
      return { filepath, message }
    },
    catch: () => null as never,
  }).pipe(Effect.catchAll(() => Effect.succeed(null)))

const explorer = cosmiconfig("gtd")

export type ConfigResult = {
  readonly config: Record<string, unknown>
  readonly filepath: string
}

export interface ResolveOptions {
  readonly cwd: string
  readonly home: string
  readonly xdgConfigHome: string
}

const tryLoad = (filepath: string): Effect.Effect<ConfigResult | null, never> =>
  Effect.tryPromise({
    try: async () => {
      await access(filepath)
      const result = await explorer.load(filepath)
      return result
        ? { config: result.config as Record<string, unknown>, filepath: result.filepath }
        : null
    },
    catch: () => null as never,
  }).pipe(Effect.catchAll(() => Effect.succeed(null)))

const searchFrom = (dir: string): Effect.Effect<ConfigResult | null, never> =>
  Effect.tryPromise({
    try: async () => {
      const result = await explorer.search(dir)
      return result
        ? { config: result.config as Record<string, unknown>, filepath: result.filepath }
        : null
    },
    catch: () => null as never,
  }).pipe(Effect.catchAll(() => Effect.succeed(null)))

const configFileNames = [
  ".gtdrc",
  ".gtdrc.json",
  ".gtdrc.yaml",
  ".gtdrc.yml",
  ".gtdrc.js",
  ".gtdrc.ts",
  ".gtdrc.mjs",
  ".gtdrc.cjs",
  "gtd.config.js",
  "gtd.config.ts",
  "gtd.config.mjs",
  "gtd.config.cjs",
]

const findFirstInDir = (dir: string): Effect.Effect<ConfigResult | null, never> =>
  Effect.gen(function* () {
    for (const name of configFileNames) {
      const result = yield* tryLoad(join(dir, name))
      if (result) return result
    }
    return null
  })

export const resolveAllConfigs = (
  options: ResolveOptions,
): Effect.Effect<ReadonlyArray<ConfigResult>, Error> =>
  Effect.gen(function* () {
    const results: ConfigResult[] = []
    const seen = new Set<string>()

    const add = (r: ConfigResult | null) => {
      if (r && !seen.has(r.filepath)) {
        seen.add(r.filepath)
        results.push(r)
      }
    }

    // 1. PWD and parent directories (cosmiconfig default search)
    add(yield* searchFrom(options.cwd))

    // 2. $XDG_CONFIG_HOME/gtd/
    add(yield* findFirstInDir(join(options.xdgConfigHome, "gtd")))

    // 3. $XDG_CONFIG_HOME/.gtdrc.*
    add(yield* findFirstInDir(options.xdgConfigHome))

    // 4. $HOME
    add(yield* findFirstInDir(options.home))

    return results
  })

const defaultCommitPrompt = `Look at the following diff and create a concise commit message, following the conventional commit standards:

{{diff}}`

const defaults: Omit<GtdConfig, "configSources"> = {
  file: "TODO.md",
  agent: "auto",
  agentPlan: "plan",
  agentBuild: "code",
  agentLearn: "plan",
  testCmd: "npm test",
  testRetries: 10,
  commitPrompt: defaultCommitPrompt,
  agentInactivityTimeout: 300,
  sandboxEnabled: false,
  sandboxBoundaries: {},
}

const decode = Schema.decodeUnknownEither(GtdConfigSchema)

export const mergeConfigs = (
  configs: ReadonlyArray<ConfigResult>,
): GtdConfig => {
  const merged: Record<string, unknown> = {}
  const configSources: string[] = []
  const mergedBoundaries: Record<string, unknown> = {}
  const mergedFilesystemAllowRead: string[] = []
  const mergedFilesystemAllowWrite: string[] = []
  const mergedNetworkAllowedDomains: string[] = []

  const validParsed: Array<{ parsed: Record<string, unknown>; filepath: string }> = []

  for (let i = 0; i < configs.length; i++) {
    const result = decode(configs[i]!.config)
    if (result._tag === "Right") {
      validParsed.push({ parsed: result.right as Record<string, unknown>, filepath: configs[i]!.filepath })
    }
  }

  for (let i = validParsed.length - 1; i >= 0; i--) {
    const { parsed, filepath } = validParsed[i]!

    if (parsed.sandboxBoundaries && typeof parsed.sandboxBoundaries === "object") {
      const boundaries = parsed.sandboxBoundaries as Record<string, unknown>
      const { filesystem, network, ...phaseBoundaries } = boundaries
      Object.assign(mergedBoundaries, phaseBoundaries)

      if (filesystem && typeof filesystem === "object") {
        const fs = filesystem as Record<string, unknown>
        if (Array.isArray(fs.allowRead)) {
          mergedFilesystemAllowRead.push(...(fs.allowRead as string[]))
        }
        if (Array.isArray(fs.allowWrite)) {
          mergedFilesystemAllowWrite.push(...(fs.allowWrite as string[]))
        }
      }

      if (network && typeof network === "object") {
        const net = network as Record<string, unknown>
        if (Array.isArray(net.allowedDomains)) {
          mergedNetworkAllowedDomains.push(...(net.allowedDomains as string[]))
        }
      }
    }

    Object.assign(merged, parsed)
    configSources.unshift(filepath)
  }

  const filesystemOverrides = mergedFilesystemAllowRead.length > 0 || mergedFilesystemAllowWrite.length > 0
    ? {
        ...(mergedFilesystemAllowRead.length > 0 ? { allowRead: [...new Set(mergedFilesystemAllowRead)] } : {}),
        ...(mergedFilesystemAllowWrite.length > 0 ? { allowWrite: [...new Set(mergedFilesystemAllowWrite)] } : {}),
      }
    : undefined

  const networkOverrides = mergedNetworkAllowedDomains.length > 0
    ? { allowedDomains: [...new Set(mergedNetworkAllowedDomains)] }
    : undefined

  const finalBoundaries = {
    ...mergedBoundaries,
    ...(filesystemOverrides ? { filesystem: filesystemOverrides } : {}),
    ...(networkOverrides ? { network: networkOverrides } : {}),
  }

  const { sandboxEscalationPolicy: _sep, sandboxApprovedEscalations: _sae, approvedEscalations: _ae, ...cleanMerged } = merged

  return {
    ...defaults,
    ...cleanMerged,
    sandboxBoundaries: finalBoundaries,
    configSources,
  } as GtdConfig
}
