import { describe, expect, it, vi } from "vitest"
import { withStaleShaRetry } from "./staleRetry.js"

const staleSha = { data: { writeRefusal: { reason: "stale-token", moved: "sha" } } }
const staleContentHash = {
  data: { writeRefusal: { reason: "stale-token", moved: "content-hash" } },
}

describe("withStaleShaRetry", () => {
  it("rethrows a content-hash refusal, never calling refetch", async () => {
    const attempt = vi.fn().mockRejectedValue(staleContentHash)
    const refetch = vi.fn()
    const tokens = { expectedHeadSha: "a", expectedContentHash: "b" }

    await expect(withStaleShaRetry(attempt, tokens, refetch)).rejects.toBe(staleContentHash)
    expect(refetch).not.toHaveBeenCalled()
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it("refetches exactly once on a sha refusal, calls attempt twice total, and resolves with the retry's value", async () => {
    const freshTokens = { expectedHeadSha: "c", expectedContentHash: "d" }
    const attempt = vi.fn().mockRejectedValueOnce(staleSha).mockResolvedValueOnce({ ok: true })
    const refetch = vi.fn().mockResolvedValue(freshTokens)
    const tokens = { expectedHeadSha: "a", expectedContentHash: "b" }

    await expect(withStaleShaRetry(attempt, tokens, refetch)).resolves.toEqual({ ok: true })
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(attempt).toHaveBeenCalledTimes(2)
    expect(attempt).toHaveBeenNthCalledWith(1, tokens)
    expect(attempt).toHaveBeenNthCalledWith(2, freshTokens)
  })

  it("rethrows a second sha refusal on the retried attempt, calling refetch only once", async () => {
    const freshTokens = { expectedHeadSha: "c", expectedContentHash: "d" }
    const attempt = vi.fn().mockRejectedValue(staleSha)
    const refetch = vi.fn().mockResolvedValue(freshTokens)
    const tokens = { expectedHeadSha: "a", expectedContentHash: "b" }

    await expect(withStaleShaRetry(attempt, tokens, refetch)).rejects.toBe(staleSha)
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it("rethrows a non-refusal error untouched, with no refetch", async () => {
    const networkError = new Error("network down")
    const attempt = vi.fn().mockRejectedValue(networkError)
    const refetch = vi.fn()
    const tokens = { expectedHeadSha: "a", expectedContentHash: "b" }

    await expect(withStaleShaRetry(attempt, tokens, refetch)).rejects.toBe(networkError)
    expect(refetch).not.toHaveBeenCalled()
    expect(attempt).toHaveBeenCalledTimes(1)
  })
})
