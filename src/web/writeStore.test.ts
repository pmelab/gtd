import { describe, expect, it, vi } from "vitest"
import type { SteeringAnchor } from "../steering/index.js"
import { cellKey, createWriteStore, indicatorCounts, latestOverlayValue } from "./writeStore.js"

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("cellKey", () => {
  it("pins every SteeringAnchor variant", () => {
    const anchors: SteeringAnchor[] = [
      { kind: "chunk", index: 2 },
      { kind: "hunk", chunkIndex: 2, index: 0 },
      { kind: "question", index: 1 },
      { kind: "option", questionIndex: 1, index: 3 },
      { kind: "paragraph", line: 7 },
    ]
    expect(anchors.map((a) => cellKey("a.md", a))).toEqual([
      "a.md:chunk:2",
      "a.md:hunk:2:0",
      "a.md:question:1",
      "a.md:option:1:3",
      "a.md:paragraph:7",
    ])
  })

  it("an anchor-less Done is <filePath>/done", () => {
    expect(cellKey("a.md", undefined, "done")).toBe("a.md/done")
  })

  it("a Done-with-note is its anchor's cell plus /done — distinct from an anchor-less done", () => {
    const anchor: SteeringAnchor = { kind: "paragraph", line: 3 }
    expect(cellKey("a.md", anchor, "done")).toBe("a.md:paragraph:3/done")
    expect(cellKey("a.md", anchor, "done")).not.toBe(cellKey("a.md", undefined, "done"))
  })

  it("a field separates two values sharing one anchor", () => {
    const anchor: SteeringAnchor = { kind: "option", questionIndex: 0, index: 2 }
    expect(cellKey("a.md", anchor, "checked")).not.toBe(cellKey("a.md", anchor, "text"))
  })
})

describe("createWriteStore — save with mutate (no tokens)", () => {
  it("drains interleaved writes FIFO, one at a time, in call order", async () => {
    const store = createWriteStore()
    const first = deferred<void>()
    const order: string[] = []

    const p1 = store.getState().save({
      cell: "a",
      optimistic: 1,
      mutate: () => {
        order.push("first-start")
        return first.promise
      },
    })
    const p2 = store.getState().save({
      cell: "b",
      optimistic: 2,
      mutate: () => {
        order.push("second-start")
        return Promise.resolve("second")
      },
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(["first-start"])

    first.resolve()
    await p1
    await p2
    expect(order).toEqual(["first-start", "second-start"])
  })

  it("an absent mutate/write settles as an immediate success: the overlay commits, nothing is sent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const store = createWriteStore()
    await store.getState().save({ cell: "a", optimistic: "typed text" })
    // The overlay commits …
    expect(store.getState().overlayValue("a")).toBe("typed text")
    // … and nothing is sent: the only signal a caller gets of the absent
    // mutation is this dev-only warning naming the cell — there is no
    // network call to assert the absence of directly.
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'writeStore: no mutation wired up for cell "a" — nothing was sent',
    )
    warn.mockRestore()
  })

  it("rolls back on rejection and leaves no residue behind after", async () => {
    const store = createWriteStore()
    store.setState({ overlay: { a: { gen: 0, value: "server value" } } })
    await expect(
      store
        .getState()
        .save({ cell: "a", optimistic: "typed", mutate: () => Promise.reject(new Error("no")) }),
    ).rejects.toThrow("no")
    expect(store.getState().overlayValue("a")).toBeUndefined()
    expect(store.getState().failed.has("a")).toBe(true)
  })

  it("does not roll back a cell a newer write has already replaced", async () => {
    const store = createWriteStore()
    const first = deferred<unknown>()
    const p1 = store
      .getState()
      .save({ cell: "a", optimistic: "first", mutate: () => first.promise })
    // The second write's own optimistic value lands before the first settles.
    const p2 = store
      .getState()
      .save({ cell: "a", optimistic: "second", mutate: () => Promise.resolve("ok") })
    expect(store.getState().overlayValue("a")).toBe("second")

    first.reject(new Error("stale"))
    await expect(p1).rejects.toThrow("stale")
    await p2
    expect(store.getState().overlayValue("a")).toBe("second")
  })

  it("never overlaps two thunks for different cells", async () => {
    const store = createWriteStore()
    const runs = vi.fn()
    const p1 = store.getState().save({
      cell: "a",
      optimistic: 1,
      mutate: () => {
        runs("first")
        return Promise.resolve()
      },
    })
    const p2 = store.getState().save({
      cell: "b",
      optimistic: 2,
      mutate: () => {
        runs("second")
        return Promise.resolve()
      },
    })
    await Promise.all([p1, p2])
    expect(runs.mock.calls.map((c) => c[0])).toEqual(["first", "second"])
  })
})

describe("createWriteStore — save with write (store-owned compare-and-swap)", () => {
  it("rejects a token-guarded write with no tokens configured on the provider", async () => {
    const store = createWriteStore()
    await expect(
      store.getState().save({ cell: "a", optimistic: "x", write: () => Promise.resolve("ok") }),
    ).rejects.toThrow("no steering file loaded yet")
  })

  it("passes the store's own configured tokens, overridden by its content-hash override, to write", async () => {
    const store = createWriteStore()
    store.setState({ tokens: { headSha: "sha-1", contentHash: "hash-1" } })
    const seen: unknown[] = []
    await store.getState().save({
      cell: "a",
      optimistic: "x",
      write: (tokens) => {
        seen.push(tokens)
        return Promise.resolve("ok")
      },
    })
    expect(seen).toEqual([{ expectedHeadSha: "sha-1", expectedContentHash: "hash-1" }])

    store.setState({ contentHashOverride: "hash-2" })
    await store.getState().save({
      cell: "b",
      optimistic: "y",
      write: (tokens) => {
        seen.push(tokens)
        return Promise.resolve("ok")
      },
    })
    expect(seen[1]).toEqual({ expectedHeadSha: "sha-1", expectedContentHash: "hash-2" })
  })

  it("reads the compare-and-swap token at dequeue time, after an earlier write already swapped the override", async () => {
    const store = createWriteStore()
    store.setState({ tokens: { headSha: "sha-1", contentHash: "hash-1" } })
    const first = deferred<{ contentHash: string }>()
    const tokensSeenBySecond: (string | undefined)[] = []

    const p1 = store.getState().save({ cell: "a", optimistic: "x", write: () => first.promise })
    const p2 = store.getState().save({
      cell: "b",
      optimistic: "y",
      write: (tokens) => {
        tokensSeenBySecond.push(tokens.expectedContentHash)
        return Promise.resolve("ok")
      },
    })

    first.resolve({ contentHash: "post-format-hash" })
    await p1
    await p2
    expect(tokensSeenBySecond).toEqual(["post-format-hash"])
  })

  it("swaps the content-hash override on a successful result carrying one", async () => {
    const store = createWriteStore()
    store.setState({ tokens: { headSha: "sha-1", contentHash: "hash-1" } })
    await store.getState().save({
      cell: "a",
      optimistic: "x",
      write: () => Promise.resolve({ contentHash: "post-format-hash" }),
    })
    expect(store.getState().contentHashOverride).toBe("post-format-hash")
  })

  it("retries a stale-token/moved:sha refusal once against freshly-refetched tokens, silently", async () => {
    const store = createWriteStore()
    store.setState({
      tokens: { headSha: "stale-sha", contentHash: "hash-1" },
      refetchTokens: () =>
        Promise.resolve({ expectedHeadSha: "fresh-sha", expectedContentHash: "hash-1" }),
    })
    const attempts: string[] = []
    const result = await store.getState().save({
      cell: "a",
      optimistic: "x",
      write: (tokens) => {
        attempts.push(tokens.expectedHeadSha)
        if (tokens.expectedHeadSha === "stale-sha") {
          return Promise.reject({ data: { writeRefusal: { reason: "stale-token", moved: "sha" } } })
        }
        return Promise.resolve("ok")
      },
    })
    expect(attempts).toEqual(["stale-sha", "fresh-sha"])
    expect(result).toBe("ok")
    // No residue left behind — this was never shown as a failure.
    expect(store.getState().failed.has("a")).toBe(false)
  })

  it("never retries a moved:content-hash refusal — a genuine concurrent edit", async () => {
    const store = createWriteStore()
    store.setState({ tokens: { headSha: "sha-1", contentHash: "hash-1" } })
    const write = vi.fn(() =>
      Promise.reject({ data: { writeRefusal: { reason: "stale-token", moved: "content-hash" } } }),
    )
    await expect(store.getState().save({ cell: "a", optimistic: "x", write })).rejects.toBeTruthy()
    expect(write).toHaveBeenCalledOnce()
    expect(store.getState().failed.get("a")).toEqual({
      reason: "stale-token",
      moved: "content-hash",
    })
  })
})

describe("createWriteStore — shadow", () => {
  it("mirrors the optimistic value and rolls it back on the followed promise's own rejection, without filing a failed entry or touching pendingCount", async () => {
    const store = createWriteStore()
    const follow = deferred<unknown>()
    store.getState().shadow("b", "mirrored", follow.promise)
    expect(store.getState().overlayValue("b")).toBe("mirrored")
    expect(store.getState().pendingCount).toBe(0)

    follow.reject(new Error("refused"))
    await follow.promise.catch(() => {})
    // Flushes the shadow's own `.catch` microtask.
    await Promise.resolve()
    expect(store.getState().overlayValue("b")).toBeUndefined()
    expect(store.getState().failed.has("b")).toBe(false)
  })

  it("a single save() the chunk's first hunk owns, shadowed by its remaining hunks, files exactly ONE failed dot for a refused write all of them share", async () => {
    const store = createWriteStore()
    store.setState({ tokens: { headSha: "sha-1", contentHash: "hash-1" } })
    const first = store.getState().save({
      cell: "hunk-0",
      optimistic: true,
      write: () =>
        Promise.reject({
          data: { writeRefusal: { reason: "stale-token", moved: "content-hash" } },
        }),
    })
    first.catch(() => {})
    store.getState().shadow("hunk-1", true, first)
    store.getState().shadow("hunk-2", true, first)

    await first.catch(() => {})
    await Promise.resolve()
    expect(store.getState().failed.size).toBe(1)
    expect(store.getState().failed.has("hunk-0")).toBe(true)
    expect(store.getState().overlayValue("hunk-0")).toBeUndefined()
    expect(store.getState().overlayValue("hunk-1")).toBeUndefined()
    expect(store.getState().overlayValue("hunk-2")).toBeUndefined()
  })
})

describe("latestOverlayValue", () => {
  it("picks whichever of the given cells was written MOST RECENTLY, by generation", async () => {
    const store = createWriteStore()
    await store.getState().save({ cell: "note", optimistic: "first save" })
    await store.getState().save({ cell: "done", optimistic: "then done-with-note" })
    expect(latestOverlayValue(store.getState().overlay, ["note", "done"])).toBe(
      "then done-with-note",
    )
  })

  it("is undefined when none of the cells has ever been touched", () => {
    const store = createWriteStore()
    expect(latestOverlayValue(store.getState().overlay, ["note", "done"])).toBeUndefined()
  })
})

describe("createWriteStore — dismiss", () => {
  it("empties the whole failed map and the counts in one tap", async () => {
    const store = createWriteStore()
    await store
      .getState()
      .save({ cell: "a", optimistic: 1, mutate: () => Promise.reject(new Error("x")) })
      .catch(() => {})
    await store
      .getState()
      .save({ cell: "b", optimistic: 2, mutate: () => Promise.reject(new Error("y")) })
      .catch(() => {})
    expect(indicatorCounts(store.getState().failed)).toEqual({
      failedCount: 2,
      otherFailedCount: 1,
    })

    store.getState().dismiss()
    expect(indicatorCounts(store.getState().failed)).toEqual({
      failedCount: 0,
      otherFailedCount: 0,
    })
    expect(store.getState().expanded).toBe(false)
  })
})
