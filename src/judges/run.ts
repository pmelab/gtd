import { fixed } from "./providers/fixed.js"
import { jev } from "./providers/jev.js"
import { llm } from "./providers/llm.js"
import type { Answerer, Question } from "./types.js"

type Provider = "fixed" | "jev" | "llm"

const PROVIDERS: readonly Provider[] = ["fixed", "jev", "llm"]

export interface RunJudgeInput {
  /** The `--provider` flag. */
  readonly provider: Provider | undefined
  /** The `--model` flag. */
  readonly model?: string | undefined
  /** The `.gtdrc` `judge:` key, merged across layers. */
  readonly configured?:
    | { readonly provider?: Provider | undefined; readonly model?: string | undefined }
    | undefined
  readonly cwd: string
  readonly answers?: string | undefined
  readonly env: Readonly<Record<string, string | undefined>>
  readonly input: string
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

/**
 * Per field, the first one set wins: flag, then `GTD_JUDGE_PROVIDER` /
 * `GTD_JUDGE_MODEL` (empty counts as unset), then `.gtdrc` `judge:`. The
 * provider/model pairing is checked on the resolved pair, whichever layer
 * supplied each half.
 */
const selectJudge = ({
  provider,
  model,
  configured,
  env,
}: Pick<RunJudgeInput, "provider" | "model" | "configured" | "env">): {
  readonly provider: Provider | undefined
  readonly model: string | undefined
} => {
  const resolved = {
    provider: provider ?? envProvider(env) ?? configured?.provider,
    model: model ?? (env["GTD_JUDGE_MODEL"] || undefined) ?? configured?.model,
  }
  return checkPairing(resolved)
}

/** The only place auto selection lives; it never falls back across providers. */
const answererFor = (opts: RunJudgeInput): Answerer => {
  const { answers, env, cwd } = opts
  const { provider, model } = selectJudge(opts)
  if (provider === "fixed") return fixed({ answersPath: answers, env })
  // A configured model asks for the llm, so it outranks a configured jev key.
  if (
    provider === "jev" ||
    (provider === undefined && model === undefined && env["TYPESAFE_API_KEY"])
  )
    return jev({ env })
  return llm({ env, cwd, model })
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
  const verdicts = await answererFor(opts)(
    questions as readonly Question[],
    (typeof state === "object" && state !== null ? state : {}) as Record<string, string>,
  )
  return JSON.stringify(verdicts) + "\n"
}
