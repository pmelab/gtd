import { describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import { DriverState, type DriverStateOps } from "./DriverState.js"
import {
  confirmSession,
  formatTable,
  parseTable,
  resolveSession,
  scopeOf,
  upsertRow,
  type SessionRow,
} from "./Sessions.js"

/** An in-memory `DriverStateOps` backed by a `Map`, mirroring the real port's `read`/`write`/`path` contract without touching a filesystem. */
const makeFakeDriverState = (initial: Record<string, string> = {}): DriverStateOps => {
  const files = new Map(Object.entries(initial))
  return {
    read: (name) => Effect.sync(() => files.get(name)),
    write: (name, content) =>
      Effect.sync(() => {
        files.set(name, content)
      }),
    path: (name) => Effect.succeed(name),
  }
}

const runWith = <A>(
  eff: Effect.Effect<A, never, DriverState>,
  driverState: DriverStateOps,
): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.provide(Layer.succeed(DriverState, driverState))))

describe("parseTable / formatTable", () => {
  it("round-trips a well-formed table", () => {
    const rows: readonly SessionRow[] = [
      { key: "scope-a#abc1234", sessionId: "sid-a", status: "fresh" },
      { key: "scope-b#def5678", sessionId: "sid-b", status: "used" },
    ]
    expect(parseTable(formatTable(rows))).toEqual(rows)
  })

  it("reads a 2-field legacy row as used", () => {
    expect(parseTable("scope-a#abc1234 sid-a\n")).toEqual([
      { key: "scope-a#abc1234", sessionId: "sid-a", status: "used" },
    ])
  })

  it("ignores malformed lines: too few/many fields, an unrecognized status, blank lines", () => {
    const content = [
      "onefield",
      "a b c d",
      "scope#hash sid notastatus",
      "",
      "  ",
      "scope-a#abc1234 sid-a fresh",
    ].join("\n")
    expect(parseTable(content)).toEqual([
      { key: "scope-a#abc1234", sessionId: "sid-a", status: "fresh" },
    ])
  })

  it("parses undefined content as no rows", () => {
    expect(parseTable(undefined)).toEqual([])
  })

  it("formats zero rows as an empty string", () => {
    expect(formatTable([])).toBe("")
  })
})

describe("scopeOf", () => {
  it("is everything before the first #", () => {
    expect(scopeOf("build.fix#abc1234")).toBe("build.fix")
  })

  it("is the whole key when there is no #", () => {
    expect(scopeOf("root")).toBe("root")
  })
})

describe("upsertRow", () => {
  it("replaces the one row whose scope matches, leaving other scopes' rows byte-identical", () => {
    const rows: readonly SessionRow[] = [
      { key: "scope-a#abc1234", sessionId: "old-a", status: "used" },
      { key: "scope-b#def5678", sessionId: "sid-b", status: "fresh" },
    ]
    const updated = upsertRow(rows, { key: "scope-a#feed000", sessionId: "new-a", status: "fresh" })
    expect(updated).toEqual([
      { key: "scope-b#def5678", sessionId: "sid-b", status: "fresh" },
      { key: "scope-a#feed000", sessionId: "new-a", status: "fresh" },
    ])
  })

  it("appends when no row for the scope exists yet", () => {
    const updated = upsertRow([], { key: "scope-a#abc1234", sessionId: "sid-a", status: "fresh" })
    expect(updated).toEqual([{ key: "scope-a#abc1234", sessionId: "sid-a", status: "fresh" }])
  })
})

describe("resolveSession", () => {
  it("mints an ephemeral id and touches nothing when there is no memory key", async () => {
    const driverState = makeFakeDriverState()
    const result = await runWith(
      resolveSession(undefined, () => "minted-id"),
      driverState,
    )
    expect(result).toEqual({ sessionId: "minted-id", resume: false })
    expect(await Effect.runPromise(driverState.read("gtd-loop-memory"))).toBeUndefined()
  })

  it("mints and writes a fresh row on a miss, reporting resume: false", async () => {
    const driverState = makeFakeDriverState()
    const result = await runWith(
      resolveSession("scope#abc1234", () => "new-id"),
      driverState,
    )
    expect(result).toEqual({ sessionId: "new-id", resume: false })
    expect(parseTable(await Effect.runPromise(driverState.read("gtd-loop-memory")))).toEqual([
      { key: "scope#abc1234", sessionId: "new-id", status: "fresh" },
    ])
  })

  it("mints a NEW id (not the stored one) when the existing row is still fresh", async () => {
    const driverState = makeFakeDriverState({
      "gtd-loop-memory": formatTable([
        { key: "scope#abc1234", sessionId: "stale-id", status: "fresh" },
      ]),
    })
    const result = await runWith(
      resolveSession("scope#abc1234", () => "fresh-id"),
      driverState,
    )
    expect(result).toEqual({ sessionId: "fresh-id", resume: false })
  })

  it("resumes the stored id once confirmSession has promoted the row to used", async () => {
    const driverState = makeFakeDriverState()
    const first = await runWith(
      resolveSession("scope#abc1234", () => "sid-1"),
      driverState,
    )
    expect(first).toEqual({ sessionId: "sid-1", resume: false })

    await runWith(confirmSession("scope#abc1234"), driverState)

    const second = await runWith(
      resolveSession("scope#abc1234", () => "sid-2"),
      driverState,
    )
    expect(second).toEqual({ sessionId: "sid-1", resume: true })
  })
})

describe("confirmSession", () => {
  it("is a no-op when the row is absent", async () => {
    const driverState = makeFakeDriverState()
    await runWith(confirmSession("scope#abc1234"), driverState)
    expect(await Effect.runPromise(driverState.read("gtd-loop-memory"))).toBeUndefined()
  })

  it("is a no-op when the row is already used", async () => {
    const driverState = makeFakeDriverState({
      "gtd-loop-memory": formatTable([
        { key: "scope#abc1234", sessionId: "sid-1", status: "used" },
      ]),
    })
    const before = await Effect.runPromise(driverState.read("gtd-loop-memory"))
    await runWith(confirmSession("scope#abc1234"), driverState)
    expect(await Effect.runPromise(driverState.read("gtd-loop-memory"))).toBe(before)
  })

  it("is a no-op when there is no memory key", async () => {
    const driverState = makeFakeDriverState()
    await runWith(confirmSession(undefined), driverState)
    expect(await Effect.runPromise(driverState.read("gtd-loop-memory"))).toBeUndefined()
  })
})
