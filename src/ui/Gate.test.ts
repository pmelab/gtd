import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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

describe("gateHandler readSteeringFile marks", () => {
  const git = (cwd: string, ...args: string[]): void => {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd })
  }
  const readView = async (dir: string) => {
    const handler = gateHandler({
      root: dir,
      host: {
        run: async (cwd: string, command: string) => {
          try {
            const stdout = execFileSync("bash", ["-c", command], { cwd, encoding: "utf8" })
            return { status: 0, stdout, stderr: "" }
          } catch (error) {
            const e = error as { status?: number; stdout?: string; stderr?: string }
            return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" }
          }
        },
        headSha: async (cwd: string) => {
          try {
            return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim()
          } catch {
            return undefined
          }
        },
        readFile: async (path: string) => {
          try {
            return { kind: "content", content: readFileSync(path, "utf8") }
          } catch {
            return { kind: "absent" }
          }
        },
      } as unknown as UiHostOps,
      endpoint: "/gate/trpc",
      clientHtml: "<html><head></head></html>",
      readStep: () => Promise.reject(new Error("unused")),
      servedFile: async () => "d.md",
    })
    const url = `http://x/gate/trpc/readSteeringFile?input=${encodeURIComponent(JSON.stringify({ filePath: "d.md" }))}`
    const body = (await (await handler(new Request(url), () => {})).json()) as {
      result: { data: { view: { nodes: { changed?: boolean }[] } } }
    }
    return body.result.data.view.nodes.map((n) => n.changed === true)
  }

  it("marks a block changed since the last gtd(human) landing, and none before one exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gtd-gate-"))
    try {
      git(dir, "init", "-q")
      writeFileSync(join(dir, "d.md"), "One.\n\nTwo.\n")
      git(dir, "add", ".")
      git(dir, "commit", "-q", "-m", "gtd(check): a → b")
      expect(await readView(dir)).toEqual([false, false])
      git(dir, "commit", "-q", "--allow-empty", "-m", "gtd(human): b → c")
      writeFileSync(join(dir, "d.md"), "One.\n\nTwo changed.\n")
      expect(await readView(dir)).toEqual([false, true])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("ignores landings of an earlier process", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gtd-gate-"))
    try {
      git(dir, "init", "-q")
      writeFileSync(join(dir, "d.md"), "Old.\n\nOther.\n")
      git(dir, "add", ".")
      git(dir, "commit", "-q", "-m", "gtd(human): a → b\n\nGtd-Step: a")
      git(dir, "commit", "-q", "--allow-empty", "-m", "unrelated work")
      writeFileSync(join(dir, "d.md"), "One.\n\nTwo.\n")
      git(dir, "commit", "-q", "-am", "gtd(check): c → d")
      expect(await readView(dir)).toEqual([false, false])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
