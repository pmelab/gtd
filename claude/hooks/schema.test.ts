import { describe, expect, test } from "vitest"

import { WIRE_SCHEMA } from "../../src/wire/index.js"
import { documents, readDocument } from "./schema"

const read = (doc: object) => () => readDocument("next --json", JSON.stringify(doc))
const NEWER = `but this gtd mod reads only schema ${WIRE_SCHEMA}: upgrade the gtd plugin to read it.`
const OLDER = `but this gtd mod reads only schema ${WIRE_SCHEMA}: upgrade gtd to the plugin's version.`

describe("readDocument", () => {
  test("reads a document at the mod's own schema", () => {
    expect(read({ schema: WIRE_SCHEMA, kind: "prompt" })()).toEqual({
      schema: WIRE_SCHEMA,
      kind: "prompt",
    })
  })

  test("refuses a newer schema and says to upgrade the plugin", () => {
    expect(read({ schema: WIRE_SCHEMA + 1 })).toThrow(
      `\`gtd next --json\` printed schema ${WIRE_SCHEMA + 1}, ${NEWER}`,
    )
  })

  test("refuses an older schema and says to upgrade gtd", () => {
    expect(read({ schema: WIRE_SCHEMA - 1 })).toThrow(
      `\`gtd next --json\` printed schema ${WIRE_SCHEMA - 1}, ${OLDER}`,
    )
  })

  test("refuses a gtd that prints no schema and says to upgrade gtd", () => {
    expect(read({ kind: "prompt" })).toThrow(`\`gtd next --json\` printed no schema, ${OLDER}`)
  })

  test("refuses a non-number schema and says to upgrade gtd", () => {
    expect(read({ schema: "1" })).toThrow(`\`gtd next --json\` printed schema "1", ${OLDER}`)
  })
})

describe("documents", () => {
  const newer = JSON.stringify({ schema: WIRE_SCHEMA + 1 })
  const docs = documents(async () => newer)

  test("each reader runs its own gtd command, a verdict on stdin", async () => {
    const calls: [string[], string | undefined][] = []
    const doc = JSON.stringify({ schema: WIRE_SCHEMA, questions: [] })
    const ok = documents(async (args, stdin) => (calls.push([args, stdin]), doc))
    await ok.next()
    await ok.land()
    await ok.land("[]")
    await ok.judge(async () => undefined)
    expect(calls).toEqual([
      [["next", "--json"], undefined],
      [["land", "--json"], undefined],
      [["judge", "answer", "--json"], "[]"],
      [["judge", "--json"], undefined],
    ])
  })

  test("every document the mod reads is checked", async () => {
    await expect(docs.next()).rejects.toThrow(`\`gtd next --json\` printed schema`)
    await expect(docs.land()).rejects.toThrow(`\`gtd land --json\` printed schema`)
    await expect(docs.land("[]")).rejects.toThrow(`\`gtd judge answer --json\` printed schema`)
    await expect(docs.judge(async () => "verdict")).rejects.toThrow(
      `\`gtd judge --json\` printed schema`,
    )
  })

  test("a judge document it cannot read never reaches the answerer", async () => {
    let asked = false
    await expect(docs.judge(async () => ((asked = true), "verdict"))).rejects.toThrow(NEWER)
    expect(asked).toBe(false)
  })

  test("a judge document it reads goes to the answerer whole", async () => {
    const doc = JSON.stringify({ schema: WIRE_SCHEMA, questions: [] })
    const ok = documents(async () => doc)
    expect(await ok.judge(async (text, j) => `${text}|${j.questions.length}`)).toBe(`${doc}|0`)
  })

  test("unparseable judge output leaves the judge step for a person", async () => {
    let asked = false
    const garbled = documents(async () => "not json")
    expect(await garbled.judge(async () => ((asked = true), "verdict"))).toBeUndefined()
    expect(asked).toBe(false)
  })

  test("a judge document with no schema stops the run and says to upgrade gtd", async () => {
    let asked = false
    const old = documents(async () => JSON.stringify({ questions: [] }))
    await expect(old.judge(async () => ((asked = true), "verdict"))).rejects.toThrow(OLDER)
    expect(asked).toBe(false)
  })

  test("next and land stay strict on unparseable output", async () => {
    const garbled = documents(async () => "not json")
    await expect(garbled.next()).rejects.toThrow(SyntaxError)
    await expect(garbled.land()).rejects.toThrow(SyntaxError)
    await expect(garbled.land("[]")).rejects.toThrow(SyntaxError)
  })

  test("a failing gtd judge leaves the judge step for a person", async () => {
    const failing = documents(async () => {
      throw new Error("exited 1")
    })
    expect(await failing.judge(async () => "verdict")).toBeUndefined()
  })
})
