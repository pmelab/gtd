// Standalone `noul`-shaped judge call for evals/judgments/eval.mjs — never
// invoked through the workflow engine (Task 4 must not depend on the
// dynamic per-section judge state a parallel package task is building in
// unified.yaml). Reuses the GTD_EVALS_URL/GTD_EVALS_KEY gateway convention
// from evals/run-turn.mjs and the pinned judge model id from
// evals/promptfooconfig.yaml — duplicated, not imported, same reason as
// run-turn.mjs's own JUDGE_MODEL: this judge must never become the model
// under test in the sibling prompt-eval matrix.
const JUDGE_MODEL = "gpt-5.4"

const SYSTEM_PROMPT = `You judge a single spec-review finding from an
autonomous coding agent's review of a change against a package's written
requirements. Answer only with the probability, from 0 to 1, that the finding
describes a genuine violation worth spending a fix turn on — not a nitpick, a
misreading of the spec, or prose already satisfied by the code. Respond with
ONLY a JSON object: {"p": <number between 0 and 1>}. No other text.`

function parseNumber(content) {
  const match = content.match(/-?\d*\.?\d+/)
  if (!match) throw new Error(`judge: no number found in judge response: ${content}`)
  return Number(match[0])
}

function inUnitRange(p) {
  return Number.isFinite(p) && p >= 0 && p <= 1
}

function extractP(content) {
  const p = parseNumber(content)
  if (!inUnitRange(p)) throw new Error(`judge: response out of [0,1] range: ${content}`)
  return p
}

/**
 * Calls the pinned judge model with one finding's markdown and returns its
 * probability that the finding is a real, actionable violation. Throws on
 * any non-2xx response or an unparseable body — a silent fallback value
 * would corrupt the sweep with a fabricated data point.
 */
export async function judgeFinding(gatewayUrl, gatewayKey, findingMarkdown) {
  const res = await fetch(`${gatewayUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${gatewayKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: findingMarkdown },
      ],
      temperature: 0,
    }),
  })
  if (!res.ok) {
    throw new Error(`judge: POST ${gatewayUrl}/chat/completions responded ${res.status}`)
  }
  const body = await res.json()
  const content = body.choices?.[0]?.message?.content
  if (!content) throw new Error(`judge: response had no message content: ${JSON.stringify(body)}`)
  return extractP(content)
}

export { JUDGE_MODEL }
