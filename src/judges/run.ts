import type { JudgeIo } from "./providers/io.js"
import { fixed } from "./providers/fixed.js"
import { jev } from "./providers/jev.js"
import { llm } from "./providers/llm.js"
import type { Answerer, Question } from "./types.js"

type Provider = "fixed" | "jev" | "llm"

const PROVIDERS: readonly Provider[] = ["fixed", "jev", "llm"]

type Configured = { readonly provider?: Provider | undefined; readonly model?: string | undefined }

export interface RunJudgeInput {
  /** The `--provider` flag. */
  readonly provider: Provider | undefined
  /** The `--model` flag. */
  readonly model?: string | undefined
  readonly cwd: string
  readonly answers?: string | undefined
  readonly env: Readonly<Record<string, string | undefined>>
  readonly input: string
  readonly io: JudgeIo
}

const fail = (message: string): never => {
  throw new Error(`gtd judge run: ${message}`)
}

const envProvider = (env: RunJudgeInput["env"]): Provider | undefined => {
  const value = env["GTD_JUDGE_PROVIDER"] || undefined
  if (value !== undefined && !PROVIDERS.includes(value as Provider))
    return fail(`GTD_JUDGE_PROVIDER must be one of ${PROVIDERS.join(", ")} — got "${value}"`)
  return value as Provider | undefined
}

const checkPairing = <T extends { provider: Provider | undefined; model: string | undefined }>(
  resolved: T,
): T =>
  resolved.model !== undefined && resolved.provider !== undefined && resolved.provider !== "llm"
    ? fail(`a model only applies to provider llm, not ${resolved.provider}`)
    : resolved

const userConfigPath = (env: RunJudgeInput["env"]): string | undefined => {
  const xdg = env["XDG_CONFIG_HOME"]
  if (xdg) return `${xdg}/gtd/judge.json`
  const home = env["HOME"]
  return home ? `${home}/.config/gtd/judge.json` : undefined
}

const readText = (io: JudgeIo, path: string): Promise<string | undefined> =>
  io
    .readFile(path)
    .catch((e: unknown) =>
      fail(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`),
    )

const parseObject = (path: string, text: string): Record<string, unknown> => {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return fail(`${path} is not valid JSON`)
  }
  return typeof json === "object" && json !== null && !Array.isArray(json)
    ? (json as Record<string, unknown>)
    : fail(`${path} must be a JSON object`)
}

const decodeUserConfig = (path: string, text: string): Configured => {
  const { provider, model, ...rest } = parseObject(path, text)
  const [extra] = Object.keys(rest)
  if (extra !== undefined) return fail(`${path}: unknown key "${extra}"`)
  if (provider !== undefined && !PROVIDERS.includes(provider as Provider))
    return fail(`${path}: "provider" must be one of ${PROVIDERS.join(", ")}`)
  if (model !== undefined && typeof model !== "string")
    return fail(`${path}: "model" must be a string`)
  return { provider: provider as Provider | undefined, model }
}

const readUserConfig = async (
  io: JudgeIo,
  env: RunJudgeInput["env"],
): Promise<Configured | undefined> => {
  const path = userConfigPath(env)
  const text = path === undefined ? undefined : await readText(io, path)
  return path === undefined || text === undefined ? undefined : decodeUserConfig(path, text)
}

/**
 * Per field, the first one set wins: flag, then `GTD_JUDGE_PROVIDER` /
 * `GTD_JUDGE_MODEL` (empty counts as unset), then the user file. The provider/model pairing is checked on the resolved pair,
 * whichever layer supplied each half.
 */
const selectJudge = (
  { provider, model, env }: Pick<RunJudgeInput, "provider" | "model" | "env">,
  user: Configured | undefined,
): Required<Configured> => {
  const layers: readonly Configured[] = [
    { provider, model },
    { provider: envProvider(env), model: env["GTD_JUDGE_MODEL"] || undefined },
    user ?? {},
  ]
  return checkPairing({
    provider: layers.find((l) => l.provider !== undefined)?.provider,
    model: layers.find((l) => l.model !== undefined)?.model,
  })
}

/** The only place auto selection lives; it never falls back across providers. */
const answererFor = async (opts: RunJudgeInput): Promise<Answerer> => {
  const { answers, env, cwd, io } = opts
  const { provider, model } = selectJudge(opts, await readUserConfig(io, env))
  if (provider === "fixed") return fixed({ answersPath: answers, env, io })
  // A configured model asks for the llm, so it outranks a configured jev key.
  if (
    provider === "jev" ||
    (provider === undefined && model === undefined && env["TYPESAFE_API_KEY"])
  )
    return jev({ env, io })
  return llm({ env, cwd, model, io })
}

export const runJudge = async (opts: RunJudgeInput): Promise<string> => {
  let doc: unknown
  try {
    doc = JSON.parse(opts.input)
  } catch {
    return fail("stdin is not valid JSON")
  }
  const { questions, state } = (doc ?? {}) as { questions?: unknown; state?: unknown }
  if (!Array.isArray(questions)) return fail('stdin has no "questions" array')
  const verdicts = await (
    await answererFor(opts)
  )(
    questions as readonly Question[],
    (typeof state === "object" && state !== null ? state : {}) as Record<string, string>,
  )
  return JSON.stringify(verdicts) + "\n"
}
