import { describe, expect, it } from "vitest"
import { feed } from "./feed.js"

describe("feed", () => {
  it("throws every problem of the spec, naming the key", () => {
    expect(() =>
      feed({
        project: "",
        every: "0s",
        mode: "auto",
        poll: async () => [],
        filter: true,
      } as never),
    ).toThrow(
      'feed.filter: is not a known key; feed.project: must be a non-empty string; feed.every: must be a positive duration like "30s", "5m" or "1h"; feed.mode: must be "propose" or "queue"',
    )
  })

  it("requires project, every, mode and poll", () => {
    expect(() => feed({} as never)).toThrow(
      "feed.project: is required; feed.every: is required; feed.mode: is required; feed.poll: is required",
    )
  })
})
