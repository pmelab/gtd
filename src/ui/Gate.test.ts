import { describe, expect, it, vi } from "vitest"
import { gateHandler, withTrpcEndpoint } from "./Gate.js"
import type { UiHostOps } from "./Ports.js"

describe("withTrpcEndpoint", () => {
  it("names the page's API path in the head, escaped", () => {
    expect(
      withTrpcEndpoint('<html><head lang="en"><title>gtd</title></head>', '/a"b/gate/trpc'),
    ).toBe(
      '<html><head lang="en"><meta name="gtd-trpc" content="/a&quot;b/gate/trpc"><title>gtd</title></head>',
    )
  })
})

describe("gateHandler setValues", () => {
  it("refuses a batch for a file the gate does not serve, without touching the disk", async () => {
    const writeFile = vi.fn(async () => undefined)
    const host = { headSha: async () => "sha", writeFile } as unknown as UiHostOps
    const handler = gateHandler({
      root: "/repo",
      host,
      endpoint: "/gate/trpc",
      clientHtml: "<html><head></head></html>",
      readStep: () => Promise.reject(new Error("unused")),
      servedFile: async () => ".gtd/TODO.md",
    })
    const response = await handler(
      new Request("http://x/gate/trpc/setValues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filePath: "other.md",
          expectedHeadSha: "sha",
          expectedContentHash: "hash",
          values: [{ anchor: { kind: "hunk", chunkIndex: 0, index: 0 }, checked: true }],
        }),
      }),
      () => {},
    )
    expect(response.status).toBe(409)
    expect(JSON.stringify(await response.json())).toContain("file-vanished")
    expect(writeFile).not.toHaveBeenCalled()
  })
})
