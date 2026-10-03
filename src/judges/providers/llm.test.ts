import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { llm, toPrompt, toSchema, toLlmVerdicts } from "./llm.js"
import type { Question } from "../types.js"
import { claudeShim as shim } from "../shim.fixture.js"

const q = (id: string, primitive: Question["primitive"], criteria = "c"): Question => ({
  id,
  primitive,
  instructions: "i",
  criteria,
})
const choice = q("c", "choice", "a: first. b: second")
const score = q("s", "score", "L1: bad. L2: ok. L3: good")
const envelope = (structured_output: unknown) =>
  JSON.stringify({ type: "result", structured_output })

describe("toSchema", () => {
  it("keys a required { answer, p } object per question with the right enums", () => {
    const schema = toSchema([q("n", "noul"), choice, score]) as any
    expect(schema.required).toEqual(["n", "c", "s"])
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.n.properties.answer.enum).toEqual(["yes", "no"])
    expect(schema.properties.c.properties.answer.enum).toEqual(["a", "b"])
    expect(schema.properties.s.properties.answer).toEqual({ enum: [1, 2, 3] })
    expect(schema.properties.n.properties.p).toEqual({ type: "number", minimum: 0, maximum: 1 })
    expect(schema.properties.n.required).toEqual(["answer", "p"])
    expect(schema.properties.n.additionalProperties).toBe(false)
  })
  it("throws naming the id on too few labels or an unknown primitive; no 10-level cap", () => {
    expect(() => toSchema([q("c", "choice", "a: only")])).toThrow(/question "c".*at least 2/)
    expect(() => toSchema([q("s", "score", "nothing")])).toThrow(/question "s".*at least 2/)
    expect(() => toSchema([q("x", "wat" as never)])).toThrow(/question "x": unknown primitive/)
    const many = Array.from({ length: 12 }, (_, i) => `L${i}: t`).join(". ")
    expect(() => toSchema([q("s", "score", many)])).not.toThrow()
  })
})

describe("toPrompt", () => {
  it("wraps evidence in tags and lists each primitive's options", () => {
    const prompt = toPrompt([q("n", "noul", "is it?"), choice, score], { note: "# body" })
    expect(prompt).toContain('<evidence key="note">\n# body\n</evidence>')
    expect(prompt).toContain("is it?")
    expect(prompt).toContain("- a: first\n- b: second")
    expect(prompt).toContain("1. bad\n2. ok\n3. good")
    expect(prompt).toContain('id="s"')
  })
})

describe("toLlmVerdicts", () => {
  const ask = [q("n", "noul"), choice, score]
  const good = { n: { answer: "no", p: 0.9 }, c: { answer: "b", p: 1 }, s: { answer: 2, p: 0 } }
  it("passes answer and p through unchanged and ignores extra ids", () => {
    expect(toLlmVerdicts(ask, envelope({ ...good, extra: 1 }))).toEqual([
      { id: "n", answer: "no", p: 0.9 },
      { id: "c", answer: "b", p: 1 },
      { id: "s", answer: 2, p: 0 },
    ])
  })
  it("rejects non-JSON, claude errors, and a non-object structured_output", () => {
    expect(() => toLlmVerdicts(ask, "x")).toThrow(
      "gtd judge run: unreadable claude response: not JSON",
    )
    expect(() =>
      toLlmVerdicts(ask, JSON.stringify({ is_error: true, result: "rate limited" })),
    ).toThrow(/gtd judge run: .*rate limited/)
    expect(() => toLlmVerdicts(ask, envelope("s"))).toThrow(/unreadable claude response/)
  })
  it("collects missing ids in question order", () => {
    expect(() => toLlmVerdicts(ask, envelope({ c: good.c }))).toThrow(
      "gtd judge run: claude answered 1 of 3 questions; missing n, s",
    )
  })
  it.each([
    ["answer out of enum", { n: { answer: "maybe", p: 0.5 } }],
    ["score as string", { n: good.n, c: good.c, s: { answer: "2", p: 0.5 } }],
    ["p 1.2", { n: { answer: "yes", p: 1.2 } }],
    ["p null", { n: { answer: "yes", p: null } }],
  ])("fails naming the id: %s", (_, out) => {
    expect(() => toLlmVerdicts(ask, envelope({ c: good.c, s: good.s, ...out }))).toThrow(
      /gtd judge run: .*"(n|s)"/,
    )
  })
})

describe("llm answerer", () => {
  const ask = [q("n", "noul")]
  const reply = envelope({ n: { answer: "yes", p: 0.7 } })
  const recording = () => {
    const log = join(mkdtempSync(join(tmpdir(), "gtd-llm-log-")), "log")
    const dir = shim(`printf '%s\\n' "$@" > ${log}\ncat > ${log}.stdin\necho '${reply}'`)
    return {
      dir,
      argv: () => readFileSync(log, "utf8").split("\n"),
      stdin: () => readFileSync(`${log}.stdin`, "utf8"),
    }
  }

  it("defaults to haiku, sends the prompt on stdin, isolates the call, never --bare", async () => {
    const r = recording()
    const out = await llm({ env: { PATH: `${r.dir}:/bin:/usr/bin` }, cwd: tmpdir() })(ask, {
      note: "evidence",
    })
    expect(out).toEqual([{ id: "n", answer: "yes", p: 0.7 }])
    const argv = r.argv()
    expect(argv.slice(argv.indexOf("--model"), argv.indexOf("--model") + 2)).toEqual([
      "--model",
      "haiku",
    ])
    expect(argv).toContain('{"disableAllHooks":true}')
    expect(argv).toContain("--no-session-persistence")
    expect(argv).not.toContain("--bare")
    expect(r.stdin()).toContain('<evidence key="note">')
  })
  it("fails when claude is missing from PATH", async () => {
    await expect(
      llm({ env: { PATH: tmpdir() + "/nope" }, cwd: tmpdir() })(ask, {}),
    ).rejects.toThrow("gtd judge run: --provider llm needs `claude` on PATH")
  })
  it("fails on a non-zero exit with stderr", async () => {
    const dir = shim("echo boom >&2; exit 3")
    await expect(
      llm({ env: { PATH: `${dir}:/bin:/usr/bin` }, cwd: tmpdir() })(ask, {}),
    ).rejects.toThrow("gtd judge run: claude exited 3: boom")
  })
  it("kills the child past the timeout", async () => {
    const dir = shim("sleep 5")
    await expect(
      llm({ env: { PATH: `${dir}:/bin:/usr/bin` }, cwd: tmpdir(), timeoutMs: 100 })(ask, {}),
    ).rejects.toThrow(/gtd judge run: claude timed out/)
  })
})
