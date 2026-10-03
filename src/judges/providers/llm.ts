import { execFile } from "node:child_process"
import { splitLabels } from "../criteria.js"
import type { Answerer, Question, Verdict } from "../types.js"

export interface LlmOptions {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd: string
  readonly model?: string | undefined
  readonly timeoutMs?: number
}

const DEFAULT_MODEL = "haiku"
const TIMEOUT_MS = 180_000

export const SYSTEM_PROMPT =
  "You are a strict, impartial judge. Answer each question from the supplied evidence alone.\n" +
  "Reply only with the structured answer; never use tools or ask questions."

const fail = (message: string): never => {
  throw new Error(`gtd judge run: ${message}`)
}

const unreadable = (why: string): never => fail(`unreadable claude response: ${why}`)

/** Validated up front so a bad question throws before any spawn. */
const levelsOf = (q: Question): [string, string][] => {
  if (q.primitive === "noul") return []
  if (q.primitive !== "choice" && q.primitive !== "score")
    return fail(`question "${q.id}": unknown primitive "${String(q.primitive)}"`)
  const levels = splitLabels(q.criteria)
  if (levels.length < 2)
    return fail(
      `question "${q.id}": ${q.primitive} criteria need at least 2 labelled ${q.primitive === "choice" ? "options" : "levels"}`,
    )
  return levels
}

const optionsOf = (q: Question): (string | number)[] =>
  q.primitive === "noul"
    ? ["yes", "no"]
    : q.primitive === "choice"
      ? levelsOf(q).map(([label]) => label)
      : levelsOf(q).map((_, i) => i + 1)

const describe = (q: Question): string => {
  const head = `<question id="${q.id}">\n${q.instructions}\n`
  if (q.primitive === "noul")
    return `${head}Criteria: ${q.criteria}\nAnswer "yes" or "no".\n</question>`
  const levels = levelsOf(q)
  const body =
    q.primitive === "choice"
      ? levels.map(([label, text]) => `- ${label}: ${text}`).join("\n")
      : levels.map(([, text], i) => `${i + 1}. ${text}`).join("\n")
  const ask =
    q.primitive === "choice"
      ? "Answer with exactly one label."
      : "Answer with the number of one level."
  return `${head}${body}\n${ask}\n</question>`
}

export const toPrompt = (
  questions: readonly Question[],
  state: Readonly<Record<string, string>>,
): string =>
  [
    "Answer every question below from the evidence alone. For each, give your answer and p, your confidence between 0 and 1 that the given answer is correct.",
    ...Object.entries(state).map(([key, body]) => `<evidence key="${key}">\n${body}\n</evidence>`),
    ...questions.map(describe),
  ].join("\n\n")

const answerSchema = (q: Question): Record<string, unknown> => {
  const answer = { enum: optionsOf(q) }
  return {
    type: "object",
    properties: { answer, p: { type: "number", minimum: 0, maximum: 1 } },
    required: ["answer", "p"],
    additionalProperties: false,
  }
}

export const toSchema = (questions: readonly Question[]): Record<string, unknown> => ({
  type: "object",
  properties: Object.fromEntries(questions.map((q) => [q.id, answerSchema(q)])),
  required: questions.map((q) => q.id),
  additionalProperties: false,
})

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const toVerdict = (q: Question, raw: unknown): Verdict => {
  if (!isObject(raw)) return unreadable(`"${q.id}" is not an object`)
  const { answer, p } = raw
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1)
    return unreadable(`"${q.id}" p is not a number in [0, 1]`)
  if (!optionsOf(q).includes(answer as string | number))
    return unreadable(`"${q.id}" answer is not one of its options`)
  return { id: q.id, answer: answer as string | number, p }
}

export const toLlmVerdicts = (questions: readonly Question[], stdout: string): Verdict[] => {
  let envelope: unknown
  try {
    envelope = JSON.parse(stdout)
  } catch {
    return unreadable("not JSON")
  }
  if (!isObject(envelope)) return unreadable("not an object")
  if (envelope["is_error"] === true) return fail(`claude failed: ${String(envelope["result"])}`)
  const out = envelope["structured_output"]
  if (!isObject(out)) return unreadable("no structured_output object")
  const missing = questions.filter((q) => !isObject(out[q.id]))
  if (missing.length > 0)
    return fail(
      `claude answered ${questions.length - missing.length} of ${questions.length} questions; missing ${missing.map((q) => q.id).join(", ")}`,
    )
  return questions.map((q) => toVerdict(q, out[q.id]))
}

const run = (
  argv: readonly string[],
  stdin: string,
  { env, cwd, timeoutMs }: { env: LlmOptions["env"]; cwd: string; timeoutMs: number },
): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      argv,
      {
        cwd,
        env: env as NodeJS.ProcessEnv,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024 * 1024,
      },
      (e, stdout, stderr) => {
        if (!e) return resolve(stdout)
        const { code, killed, message } = e as NodeJS.ErrnoException & { killed?: boolean }
        reject(
          new Error(
            code === "ENOENT"
              ? "gtd judge run: --provider llm needs `claude` on PATH"
              : killed
                ? `gtd judge run: claude timed out after ${timeoutMs} ms`
                : typeof code === "number"
                  ? `gtd judge run: claude exited ${code}: ${stderr.slice(0, 2048)}`
                  : `gtd judge run: claude failed to start: ${message}`,
          ),
        )
      },
    )
    child.stdin?.on("error", () => {})
    child.stdin?.end(stdin)
  })

export const llm =
  ({ env, cwd, model = DEFAULT_MODEL, timeoutMs = TIMEOUT_MS }: LlmOptions): Answerer =>
  async (questions, state) => {
    const schema = JSON.stringify(toSchema(questions))
    const prompt = toPrompt(questions, state)
    // `disableAllHooks` is load-bearing: a hook-driven host session must not
    // fire on, or hijack, this nested call. Never `--bare`: it skips login reuse.
    const stdout = await run(
      [
        "-p",
        "--model",
        model,
        "--output-format",
        "json",
        "--json-schema",
        schema,
        "--system-prompt",
        SYSTEM_PROMPT,
        "--tools",
        "",
        "--no-session-persistence",
        "--settings",
        '{"disableAllHooks":true}',
      ],
      prompt,
      { env, cwd, timeoutMs },
    )
    return toLlmVerdicts(questions, stdout)
  }
