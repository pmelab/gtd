import { Effect, Exit } from "effect"
import { describe, expect, it } from "vitest"
import { WIRE_SCHEMA } from "../wire/index.js"
import { writeScript, type JsonMode } from "./Output.js"

const run = (json: JsonMode, script: string, plain?: string) => {
  let written = ""
  const out = { write: (chunk: string | Uint8Array) => (written += String(chunk)), flush: () => {} }
  const exit = Effect.runSyncExit(writeScript(json, out, script, plain))
  return { exit, written }
}

describe("writeScript", () => {
  it("plain prints the script, or the plain text when given", () => {
    expect(run({ kind: "off" }, "git reset\n").written).toBe("git reset\n")
    expect(run({ kind: "off" }, "", "nothing to do\n").written).toBe("nothing to do\n")
  })

  it("--json prints { schema, script }, the script ending in exactly one newline", () => {
    expect(JSON.parse(run({ kind: "document" }, "git reset\n\n").written)).toEqual({
      schema: WIRE_SCHEMA,
      script: "git reset\n",
    })
    expect(JSON.parse(run({ kind: "document" }, "", "nothing\n").written)).toEqual({
      schema: WIRE_SCHEMA,
      script: "",
    })
  })

  it("--json=script prints the script alone; an unknown path fails", () => {
    expect(run({ kind: "select", path: "script" }, "git reset").written).toBe("git reset\n\n")
    expect(run({ kind: "select", path: "schema" }, "x").written).toBe(`${WIRE_SCHEMA}\n`)
    expect(Exit.isFailure(run({ kind: "select", path: "nope" }, "x").exit)).toBe(true)
  })
})
