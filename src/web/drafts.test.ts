import { describe, expect, it } from "vitest"
import {
  bannerFor,
  discardDraft,
  hasDraft,
  loadDraft,
  saveDraft,
  shouldApplyBackgroundRefresh,
  type DraftStorage,
} from "./drafts.js"

/** An in-memory `DraftStorage` — real key/value semantics, no browser API. */
const fakeStorage = (): DraftStorage => {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

describe("saveDraft / loadDraft", () => {
  it("leaves the typed text recoverable after a page reload (a fresh read off the same storage)", () => {
    const storage = fakeStorage()
    saveDraft(storage, "wt1", ".gtd/REVIEW.md", "my unsent note", { reason: "not-resting" })
    // Simulates a reload: nothing but the storage itself carries over.
    const reloaded = loadDraft(storage, "wt1", ".gtd/REVIEW.md")
    expect(reloaded?.text).toBe("my unsent note")
  })

  it("returns undefined when no draft was ever saved", () => {
    expect(loadDraft(fakeStorage(), "wt1", ".gtd/REVIEW.md")).toBeUndefined()
  })

  it("returns undefined for corrupt stored JSON, never throws", () => {
    const storage = fakeStorage()
    storage.setItem("gtd:draft:wt1:.gtd/REVIEW.md", "{not json")
    expect(() => loadDraft(storage, "wt1", ".gtd/REVIEW.md")).not.toThrow()
    expect(loadDraft(storage, "wt1", ".gtd/REVIEW.md")).toBeUndefined()
  })

  it("drafts for two files in one worktree do not overwrite each other", () => {
    const storage = fakeStorage()
    saveDraft(storage, "wt1", ".gtd/REVIEW.md", "review text", { reason: "not-resting" })
    saveDraft(storage, "wt1", ".gtd/TODO.md", "todo text", { reason: "not-resting" })
    expect(loadDraft(storage, "wt1", ".gtd/REVIEW.md")?.text).toBe("review text")
    expect(loadDraft(storage, "wt1", ".gtd/TODO.md")?.text).toBe("todo text")
  })

  it("drafts for the same file path in two worktrees do not overwrite each other", () => {
    const storage = fakeStorage()
    saveDraft(storage, "wt1", ".gtd/REVIEW.md", "wt1 text", { reason: "not-resting" })
    saveDraft(storage, "wt2", ".gtd/REVIEW.md", "wt2 text", { reason: "not-resting" })
    expect(loadDraft(storage, "wt1", ".gtd/REVIEW.md")?.text).toBe("wt1 text")
    expect(loadDraft(storage, "wt2", ".gtd/REVIEW.md")?.text).toBe("wt2 text")
  })
})

describe("bannerFor", () => {
  it("names which half of the compare-and-swap token moved", () => {
    expect(bannerFor({ reason: "stale-token", moved: "sha" })).toMatch(/committed/i)
    expect(bannerFor({ reason: "stale-token", moved: "content-hash" })).toMatch(/changed on disk/i)
  })

  it("names a rest-gate refusal distinctly", () => {
    expect(bannerFor({ reason: "not-resting" })).toMatch(/no longer waiting on a human/i)
  })

  it("names a vanished file distinctly", () => {
    expect(bannerFor({ reason: "file-vanished" })).toMatch(/no longer exists/i)
  })

  it("names an unresolved anchor distinctly", () => {
    expect(bannerFor({ reason: "anchor-unresolved" })).toMatch(/no longer exists in this document/i)
  })
})

describe("discardDraft / hasDraft / shouldApplyBackgroundRefresh", () => {
  it("a background refresh with a draft present does not replace the screen", () => {
    const storage = fakeStorage()
    saveDraft(storage, "wt1", ".gtd/REVIEW.md", "text", { reason: "not-resting" })
    expect(shouldApplyBackgroundRefresh(storage, "wt1", ".gtd/REVIEW.md")).toBe(false)
  })

  it("a background refresh with no draft present does replace the screen", () => {
    const storage = fakeStorage()
    expect(shouldApplyBackgroundRefresh(storage, "wt1", ".gtd/REVIEW.md")).toBe(true)
  })

  it("discarding a draft clears it and lets the next refresh through", () => {
    const storage = fakeStorage()
    saveDraft(storage, "wt1", ".gtd/REVIEW.md", "text", { reason: "not-resting" })
    expect(hasDraft(storage, "wt1", ".gtd/REVIEW.md")).toBe(true)
    discardDraft(storage, "wt1", ".gtd/REVIEW.md")
    expect(hasDraft(storage, "wt1", ".gtd/REVIEW.md")).toBe(false)
    expect(shouldApplyBackgroundRefresh(storage, "wt1", ".gtd/REVIEW.md")).toBe(true)
  })
})
