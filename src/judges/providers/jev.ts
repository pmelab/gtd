import { splitLabels } from "../criteria.js"
import type { Answerer, Question, Verdict } from "../types.js"

export interface JevOptions {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly retryDelayMs?: number
}

const DEFAULT_URL = "https://api.typesafe.ai/v1/systemone"
const MODEL = "jev-latest"
const RETRIES = 3

const fail = (message: string): never => {
  throw new Error(`gtd judge run: ${message}`)
}

const translate = (q: Question): Record<string, unknown> => {
  if (q.primitive === "noul") {
    return { type: "noul", instructions: `${q.instructions}\n\nCriteria: ${q.criteria}` }
  }
  const levels = splitLabels(q.criteria)
  if (q.primitive === "choice") {
    if (levels.length < 2)
      return fail(`question "${q.id}": choice criteria need at least 2 labelled options`)
    return { type: "choice", instructions: q.instructions, criteria: Object.fromEntries(levels) }
  }
  if (q.primitive === "score") {
    if (levels.length < 2 || levels.length > 10) {
      return fail(
        `question "${q.id}": score criteria need 2 to 10 labelled levels, found ${levels.length}`,
      )
    }
    return { type: "score", instructions: q.instructions, criteria: levels.map(([, v]) => v) }
  }
  return fail(`question "${q.id}": unknown primitive "${String(q.primitive)}"`)
}

export const toRequest = (
  questions: readonly Question[],
  state: Readonly<Record<string, string>>,
): {
  model: string
  state: Readonly<Record<string, string>>
  questions: Record<string, unknown>
} => ({
  model: MODEL,
  state,
  questions: Object.fromEntries(questions.map((q) => [q.id, translate(q)])),
})

const clamp = (n: number): number => Math.min(1, Math.max(0, n))

const unreadable = (why: string): never => fail(`unreadable jev response: ${why}`)

const num = (v: unknown, what: string): number =>
  typeof v === "number" && Number.isFinite(v) ? v : unreadable(`${what} is not a finite number`)

const probs = (a: Record<string, unknown>, id: string): Record<string, number> => {
  const raw = a["probabilities"]
  if (typeof raw !== "object" || raw === null) return unreadable(`"${id}" has no probabilities`)
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, num(v, `"${id}" probability "${k}"`)]),
  )
}

const toVerdict = (q: Question, a: Record<string, unknown>): Verdict => {
  if (a["type"] !== q.primitive)
    return unreadable(`"${q.id}" answered as ${String(a["type"])}, asked ${q.primitive}`)
  if (q.primitive === "noul") {
    const n = num(a["noul"], `"${q.id}" noul`)
    return n >= 0.5
      ? { id: q.id, answer: "yes", p: clamp(n) }
      : { id: q.id, answer: "no", p: clamp(1 - n) }
  }
  const p = probs(a, q.id)
  if (q.primitive === "choice") {
    const choice = a["choice"]
    if (typeof choice !== "string" || !(choice in p)) {
      return unreadable(`"${q.id}" choice is absent from its probabilities`)
    }
    return { id: q.id, answer: choice, p: clamp(p[choice] as number) }
  }
  const levels = Object.entries(p).map(([k, v]) => [Number(k), v] as const)
  if (levels.length === 0 || levels.some(([k]) => !Number.isFinite(k))) {
    return unreadable(`"${q.id}" score probabilities are not numeric levels`)
  }
  const top = levels.reduce((best, cur) =>
    cur[1] > best[1] || (cur[1] === best[1] && cur[0] < best[0]) ? cur : best,
  )
  return { id: q.id, answer: top[0], p: clamp(top[1]) }
}

export const toVerdicts = (questions: readonly Question[], response: unknown): Verdict[] => {
  const answers = (response as { answers?: unknown } | null)?.answers
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
    return unreadable('no "answers" object')
  }
  const map = answers as Record<string, unknown>
  const missing = questions.filter((q) => typeof map[q.id] !== "object" || map[q.id] === null)
  if (missing.length > 0)
    return fail(
      `jev answered ${questions.length - missing.length} of ${questions.length} questions; missing ${missing.map((q) => q.id).join(", ")}`,
    )
  return questions.map((q) => toVerdict(q, map[q.id] as Record<string, unknown>))
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const post = async (url: string, key: string, body: string, delayMs: number): Promise<string> => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(180_000),
    }).catch((e: unknown) =>
      fail(`jev request failed: ${e instanceof Error ? e.message : String(e)}`),
    )
    const text = await res.text()
    if (res.status === 200) return text
    if ((res.status === 429 || res.status === 529) && attempt < RETRIES) {
      await sleep(delayMs)
      continue
    }
    return fail(`jev responded ${res.status}: ${text.slice(0, 2048)}`)
  }
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return unreadable("not JSON")
  }
}

export const jev =
  ({ env, retryDelayMs = 2000 }: JevOptions): Answerer =>
  async (questions, state) => {
    const key = env["TYPESAFE_API_KEY"]
    if (key === undefined || key === "") return fail("--provider jev needs TYPESAFE_API_KEY")
    const url = env["JEV_BASE_URL"] || DEFAULT_URL
    const text = await post(url, key, JSON.stringify(toRequest(questions, state)), retryDelayMs)
    return toVerdicts(questions, parse(text))
  }
