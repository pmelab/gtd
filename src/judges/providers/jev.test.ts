import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "vitest"
import { jev, toRequest, toVerdicts } from "./jev.js"
import type { Question } from "../types.js"

const q = (id: string, primitive: Question["primitive"], criteria = "c"): Question => ({
  id,
  primitive,
  instructions: "i",
  criteria,
})

const noul = (n: number) =>
  toVerdicts([q("a", "noul")], { answers: { a: { type: "noul", noul: n } } })[0]

describe("toVerdicts", () => {
  it("noul above, at and below 0.5 answers the confidence in the answer given", () => {
    expect(noul(0.9)).toEqual({ id: "a", answer: "yes", p: 0.9 })
    expect(noul(0.5)).toEqual({ id: "a", answer: "yes", p: 0.5 })
    expect(noul(0.1)?.answer).toBe("no")
    expect(noul(0.1)?.p).toBeCloseTo(0.9)
  })
  it("choice reads its own probability; one absent from probabilities is unreadable", () => {
    const ask = [q("a", "choice")]
    expect(
      toVerdicts(ask, {
        answers: { a: { type: "choice", choice: "x", probabilities: { x: 0.6, y: 0.4 } } },
      }),
    ).toEqual([{ id: "a", answer: "x", p: 0.6 }])
    expect(() =>
      toVerdicts(ask, { answers: { a: { type: "choice", choice: "z", probabilities: { x: 1 } } } }),
    ).toThrow(/unreadable/)
  })
  it("score takes the top level as a number, ties to the lower level", () => {
    const ask = [q("a", "score")]
    const score = (probabilities: Record<string, number>) =>
      toVerdicts(ask, { answers: { a: { type: "score", probabilities } } })[0]
    expect(score({ "1": 0.1, "2": 0.7, "3": 0.2 })).toEqual({ id: "a", answer: 2, p: 0.7 })
    expect(score({ "3": 0.4, "1": 0.4, "2": 0.2 })).toEqual({ id: "a", answer: 1, p: 0.4 })
  })
  it("clamps p into [0, 1]", () => {
    expect(noul(1.5)?.p).toBe(1)
    expect(noul(-0.5)?.p).toBe(1)
    expect(
      toVerdicts([q("a", "choice")], {
        answers: { a: { type: "choice", choice: "x", probabilities: { x: 2 } } },
      })[0]?.p,
    ).toBe(1)
  })
  it("rejects an unreadable response", () => {
    const ask = [q("a", "noul")]
    expect(() => toVerdicts(ask, {})).toThrow(/unreadable/)
    expect(() => toVerdicts(ask, { answers: { a: { type: "choice" } } })).toThrow(/unreadable/)
    expect(() => toVerdicts(ask, { answers: { a: { type: "noul", noul: "x" } } })).toThrow(
      /unreadable/,
    )
  })
  it("names the missing ids and ignores extras", () => {
    const ask = [q("a", "noul"), q("b", "noul")]
    expect(() => toVerdicts(ask, { answers: { a: { type: "noul", noul: 1 } } })).toThrow(
      /missing b/,
    )
    expect(
      toVerdicts([q("a", "noul")], {
        answers: { a: { type: "noul", noul: 1 }, z: { type: "noul", noul: 0 } },
      }),
    ).toHaveLength(1)
  })
})

describe("toRequest", () => {
  it("keys questions by id, renames primitive to type and folds noul criteria into instructions", () => {
    expect(toRequest([q("a", "noul", "crit")], { k: "v" })).toEqual({
      model: "jev-latest",
      state: { k: "v" },
      questions: { a: { type: "noul", instructions: "i\n\nCriteria: crit" } },
    })
  })
  it("splits choice criteria on leading labels", () => {
    const body = toRequest([q("a", "choice", "yes: it is fine. no: it is not")], {}).questions
    expect(body).toEqual({
      a: { type: "choice", instructions: "i", criteria: { yes: "it is fine", no: "it is not" } },
    })
  })
  it("choice needs two labels", () => {
    expect(() => toRequest([q("a", "choice", "only: one")], {})).toThrow(/"a"/)
  })
  it("score sends ordered rubrics, needing 2 to 10 levels", () => {
    expect(toRequest([q("a", "score", "L1: bad. L2: good")], {}).questions).toEqual({
      a: { type: "score", instructions: "i", criteria: ["bad", "good"] },
    })
    expect(() => toRequest([q("a", "score", "L1: bad")], {})).toThrow(/"a"/)
    const levels = (n: number) => Array.from({ length: n }, (_, i) => `L${i}: r`).join(". ")
    expect(() => toRequest([q("a", "score", levels(10))], {})).not.toThrow()
    expect(() => toRequest([q("a", "score", levels(11))], {})).toThrow(/"a"/)
  })
})

describe("jev transport", () => {
  const serve = async (statuses: number[], body: string) => {
    let calls = 0
    const server = createServer((req, res) => {
      req.resume()
      res.writeHead(statuses[Math.min(calls++, statuses.length - 1)] as number)
      res.end(body)
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
    return { url, calls: () => calls, close: () => server.close() }
  }
  const ok = '{"answers":{"a":{"type":"noul","noul":1}}}'

  it("rejects without a key", async () => {
    await expect(jev({ env: {} })([q("a", "noul")], {})).rejects.toThrow(/needs TYPESAFE_API_KEY/)
  })
  it("retries 429 and 529 then succeeds", async () => {
    const s = await serve([429, 529, 200], ok)
    const env = { TYPESAFE_API_KEY: "k", JEV_BASE_URL: s.url }
    await expect(jev({ env, retryDelayMs: 0 })([q("a", "noul")], {})).resolves.toHaveLength(1)
    expect(s.calls()).toBe(3)
    s.close()
  })
  it("gives up after 3 retries", async () => {
    const s = await serve([429], "slow down")
    const env = { TYPESAFE_API_KEY: "k", JEV_BASE_URL: s.url }
    await expect(jev({ env, retryDelayMs: 0 })([q("a", "noul")], {})).rejects.toThrow(
      /429.*slow down/,
    )
    expect(s.calls()).toBe(4)
    s.close()
  })
  it("fails at once on another non-200, carrying the body", async () => {
    const s = await serve([500], "boom")
    const env = { TYPESAFE_API_KEY: "k", JEV_BASE_URL: s.url }
    await expect(jev({ env, retryDelayMs: 0 })([q("a", "noul")], {})).rejects.toThrow(/500.*boom/)
    expect(s.calls()).toBe(1)
    s.close()
  })
  it("rejects a body that is not JSON", async () => {
    const s = await serve([200], "<html>")
    const env = { TYPESAFE_API_KEY: "k", JEV_BASE_URL: s.url }
    await expect(jev({ env, retryDelayMs: 0 })([q("a", "noul")], {})).rejects.toThrow(/not JSON/)
    s.close()
  })
})
