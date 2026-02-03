import { Config, Context, Effect, Layer } from "effect"

export interface GtdConfig {
  readonly file: string
  readonly agent: string
  readonly agentPlan: string
  readonly agentBuild: string
  readonly agentLearn: string
  readonly testCmd: string
  readonly testRetries: number
  readonly commitPrompt: string
  readonly agentInactivityTimeout: number
  readonly agentForbiddenTools: ReadonlyArray<string>
}

const defaultCommitPrompt = `Look at the following diff and create a concise commit message, following the conventional commit standards:

{{diff}}`

export class GtdConfigService extends Context.Tag("GtdConfigService")<
  GtdConfigService,
  GtdConfig
>() {
  static Live = Layer.effect(
    GtdConfigService,
    Effect.gen(function* () {
      const file = yield* Config.string("GTD_FILE").pipe(Config.withDefault("TODO.md"))
      const agent = yield* Config.string("GTD_AGENT").pipe(Config.withDefault("auto"))
      const agentPlan = yield* Config.string("GTD_AGENT_PLAN").pipe(Config.withDefault("plan"))
      const agentBuild = yield* Config.string("GTD_AGENT_BUILD").pipe(Config.withDefault("code"))
      const agentLearn = yield* Config.string("GTD_AGENT_LEARN").pipe(Config.withDefault("plan"))
      const testCmd = yield* Config.string("GTD_TEST_CMD").pipe(Config.withDefault("npm test"))
      const testRetries = yield* Config.integer("GTD_TEST_RETRIES").pipe(Config.withDefault(10))
      const commitPrompt = yield* Config.string("GTD_COMMIT_PROMPT").pipe(
        Config.withDefault(defaultCommitPrompt),
      )
      const agentInactivityTimeout = yield* Config.integer("GTD_AGENT_INACTIVITY_TIMEOUT").pipe(
        Config.withDefault(300),
      )
      const agentForbiddenToolsRaw = yield* Config.string("GTD_AGENT_FORBIDDEN_TOOLS").pipe(
        Config.withDefault("AskUserQuestion"),
      )
      const agentForbiddenTools = agentForbiddenToolsRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      return {
        file,
        agent,
        agentPlan,
        agentBuild,
        agentLearn,
        testCmd,
        testRetries,
        commitPrompt,
        agentInactivityTimeout,
        agentForbiddenTools,
      }
    }),
  )
}
