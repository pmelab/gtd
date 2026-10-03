// gtd's `llm` judge provider, answered by a subagent instead of `claude -p`.
// A port of src/judges/providers/llm.ts (which needs Node, which a mod has
// not): claude/hooks/judge.test.ts pins the prompt to gtd's own, so the two
// cannot drift apart unnoticed.

type Question = {
  id: string
  primitive: string
  instructions: string
  criteria: string
}

export type Judgment = { state?: Record<string, string>; questions: Question[] }

type Verdict = { id: string; answer: string | number; p: number }

export const JUDGE_SYSTEM =
  "You are a strict, impartial judge. Answer each question from the supplied evidence alone.\n" +
  "Reply only with the structured answer; never use tools or ask questions."

const LABEL = /(?:^|\. )([A-Za-z][A-Za-z0-9_-]*): /g

const splitLabels = (criteria: string): [string, string][] => {
  const hits = [...criteria.matchAll(LABEL)]
  return hits.map((m, i) => {
    const start = m.index + m[0].length
    const end = hits[i + 1]?.index ?? criteria.length
    return [m[1] as string, criteria.slice(start, end).replace(/^ /, "")]
  })
}

// A string is why the question cannot be put to a model.
const levelsOf = (q: Question): [string, string][] | string => {
  if (q.primitive === "noul") return []
  if (q.primitive !== "choice" && q.primitive !== "score") {
    return `question "${q.id}": unknown primitive "${q.primitive}"`
  }
  const levels = splitLabels(q.criteria)
  return levels.length < 2
    ? `question "${q.id}": ${q.primitive} criteria need at least 2 labelled ${q.primitive === "choice" ? "options" : "levels"}`
    : levels
}

const optionsOf = (q: Question, levels: [string, string][]): (string | number)[] =>
  q.primitive === "noul"
    ? ["yes", "no"]
    : q.primitive === "choice"
      ? levels.map(([label]) => label)
      : levels.map((_, i) => i + 1)

const describe = (q: Question, levels: [string, string][]) => {
  const head = `<question id="${q.id}">\n${q.instructions}\n`
  if (q.primitive === "noul")
    return `${head}Criteria: ${q.criteria}\nAnswer "yes" or "no".\n</question>`
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

// The prompt gtd's llm provider sends; throws for criteria it cannot ask about.
export function judgePrompt(j: Judgment): string {
  const parts = [
    "Answer every question below from the evidence alone. For each, give your answer and p, your confidence between 0 and 1 that the given answer is correct.",
  ]
  for (const [key, body] of Object.entries(j.state ?? {}))
    parts.push(`<evidence key="${key}">\n${body}\n</evidence>`)
  for (const q of j.questions) {
    const levels = levelsOf(q)
    if (typeof levels === "string") throw new Error(levels)
    parts.push(describe(q, levels))
  }
  return parts.join("\n\n")
}

// The reply `{ <id>: { answer, p } }` as gtd's verdict array, every question
// answered with one of its own options; a string is why it is not usable.
export function toVerdicts(j: Judgment, reply: unknown): Verdict[] | string {
  if (typeof reply !== "object" || reply === null) return "the reply is not an object"
  const out: Verdict[] = []
  for (const q of j.questions) {
    const raw = (reply as Record<string, unknown>)[q.id] as
      | { answer?: unknown; p?: unknown }
      | undefined
    const levels = levelsOf(q)
    if (typeof levels === "string") return levels
    if (!raw || typeof raw.p !== "number" || raw.p < 0 || raw.p > 1)
      return `"${q.id}" has no p in [0, 1]`
    if (!optionsOf(q, levels).includes(raw.answer as string | number))
      return `"${q.id}" answer is not one of its options`
    out.push({ id: q.id, answer: raw.answer as string | number, p: raw.p })
  }
  return out
}
