import { afterEach, describe, expect, it } from "vitest"
import { GTD_VERSION, PIN_KEY } from "../install/index.js"
import { launchFor } from "./Launch.js"

const pin =
  (header = "gtdpin 1 gtd 1.2.3") =>
  () => ({
    path: "/repo/.gtd/process.gtdpin",
    bytes: Buffer.from(`${header}\n`),
  })
const argv = (...words: string[]) => ["node", "gtd", ...words]

describe("launchFor", () => {
  afterEach(() => {
    delete (globalThis as { [PIN_KEY]?: unknown })[PIN_KEY]
  })

  it("hands a state command over to the pin", () => {
    expect(launchFor(argv("next"), pin())).toMatchObject({ kind: "pin", version: "1.2.3" })
  })

  it("never hands over from inside a pin", () => {
    ;(globalThis as { [PIN_KEY]?: unknown })[PIN_KEY] = { version: "1.2.3" }
    expect(launchFor(argv("next"), pin())).toEqual({ kind: "live", argv: argv("next") })
  })

  it("strips --live, but keeps one after --", () => {
    expect(launchFor(argv("--live", "start", "--", "--live"), pin())).toEqual({
      kind: "live",
      argv: argv("start", "--", "--live"),
    })
    expect(launchFor(argv("start", "--", "--live"), pin())).toMatchObject({
      kind: "pin",
      argv: argv("start", "--", "--live"),
    })
  })

  it("leaves the version to this gtd without a pin, and for a file that is no pin", () => {
    expect(launchFor(argv("-V"), () => undefined)).toEqual({ kind: "live", argv: argv("-V") })
    expect(launchFor(argv("version"), pin("garbage"))).toEqual({
      kind: "output",
      stdout: `${GTD_VERSION}\n`,
    })
  })

  it("names a newer pin's version even when it cannot run it", () => {
    expect(launchFor(argv("--version"), pin("gtdpin 9 gtd 99.0.0"))).toEqual({
      kind: "output",
      stdout: `${GTD_VERSION} (this process is pinned to gtd 99.0.0)\n`,
    })
  })
})
