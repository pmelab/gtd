import { describe, expect, it } from "vitest"
import { GTD_SESSION_NAMESPACE, resolveSession, uuidv5 } from "./Sessions.js"

// RFC 4122 §4.3 test vector — the DNS namespace uuidv5-hashing "www.example.com"
// is the standard, tool-independent proof that a hand-rolled v5 implementation
// is correct (unlike a gtd-namespace id, which no external source publishes).
const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

describe("uuidv5", () => {
  it("matches the RFC 4122 test vector", () => {
    expect(uuidv5(DNS_NAMESPACE, "www.example.com")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2")
  })

  it("sets the version nibble to 5 and the variant bits to 10xx", () => {
    const id = uuidv5(GTD_SESSION_NAMESPACE, "build.fix#abc1234")
    expect(id[14]).toBe("5")
    expect(["8", "9", "a", "b"]).toContain(id[19])
  })

  it("is deterministic: the same name always yields the same id", () => {
    expect(uuidv5(GTD_SESSION_NAMESPACE, "root#abc1234")).toBe(
      uuidv5(GTD_SESSION_NAMESPACE, "root#abc1234"),
    )
  })

  it("a one-character-different name yields a different id", () => {
    expect(uuidv5(GTD_SESSION_NAMESPACE, "root#abc1234")).not.toBe(
      uuidv5(GTD_SESSION_NAMESPACE, "root#abc1235"),
    )
  })
})

describe("resolveSession", () => {
  it("derives the same id for the same memory key, passing resume through verbatim", () => {
    expect(resolveSession("root#abc1234", false)).toEqual({
      sessionId: uuidv5(GTD_SESSION_NAMESPACE, "root#abc1234"),
      resume: false,
    })
    expect(resolveSession("root#abc1234", true)).toEqual({
      sessionId: uuidv5(GTD_SESSION_NAMESPACE, "root#abc1234"),
      resume: true,
    })
  })

  it("a different memory key derives a different id", () => {
    const a = resolveSession("root#abc1234", false)
    const b = resolveSession("root#feed000", false)
    expect(a.sessionId).not.toBe(b.sessionId)
  })

  it("mints a random, non-repeating id and forces resume: false when there is no memory key", () => {
    let calls = 0
    const mint = () => `minted-${++calls}`
    const first = resolveSession(undefined, true, mint)
    const second = resolveSession(undefined, true, mint)
    expect(first).toEqual({ sessionId: "minted-1", resume: false })
    expect(second).toEqual({ sessionId: "minted-2", resume: false })
  })
})
