import { Effect } from "effect"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { liveJudgeIo, type ClaudeOutcome, type JudgeIo } from "../../src/judges/index.js"
import { NodeServices } from "../../src/platform/index.js"
import { InMemRepo } from "../../src/twins/index.js"
import { inMemoryJudgeIo, type ScriptedClaude } from "../integration/support/judge-io.js"

// The judge's file reads, posts and `claude` calls, live and in memory, held
// to the same answers — what lets every judge scenario run in-process. Each
// case states what `claude` does once: a shell script for the live tier, a
// scripted reply for the in-memory one.
interface Claude {
  readonly script: string
  readonly reply: ScriptedClaude
}

const nodeJudgeIo = await Effect.runPromise(liveJudgeIo.pipe(Effect.provide(NodeServices.layer)))

/** What the endpoint answers every post with. */
interface Endpoint {
  readonly status: number
  readonly body: string
}

/** What reached the endpoint, header names lower-cased. */
interface Received {
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

interface Served {
  readonly url: string
  readonly io: JudgeIo
  readonly received: () => Received | undefined
}

interface Tier {
  readonly root: string
  readonly write: (path: string, content: string) => void
  readonly io: (claude?: Claude) => JudgeIo
  /** A URL answering every post with `endpoint`, and the io that reaches it. */
  readonly serve: (endpoint: Endpoint) => Promise<Served>
  /** The PATH `claude` is looked up on. */
  readonly path: string
  readonly dispose: () => void
}

const live = (): Tier => {
  const root = mkdtempSync(join(tmpdir(), "gtd-judge-io-"))
  const bin = mkdtempSync(join(tmpdir(), "gtd-judge-io-bin-"))
  const closers: (() => void)[] = []
  return {
    root,
    write: (path, content) => writeFileSync(join(root, path), content),
    io: (claude) => {
      if (claude !== undefined) {
        writeFileSync(join(bin, "claude"), `#!/bin/sh\n${claude.script}\n`)
        chmodSync(join(bin, "claude"), 0o755)
      }
      return nodeJudgeIo
    },
    serve: async ({ status, body }) => {
      let received: Received | undefined
      const server = createServer((req, res) => {
        const chunks: Buffer[] = []
        req.on("data", (chunk: Buffer) => chunks.push(chunk))
        req.on("end", () => {
          received = {
            headers: req.headers as Record<string, string>,
            body: Buffer.concat(chunks).toString(),
          }
          res.writeHead(status).end(body)
        })
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      closers.push(() => server.close())
      return {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
        io: nodeJudgeIo,
        received: () => received,
      }
    },
    path: `${bin}:/bin:/usr/bin`,
    dispose: () => {
      for (const close of closers) close()
      rmSync(root, { recursive: true, force: true })
      rmSync(bin, { recursive: true, force: true })
    },
  }
}

const inMemory = (): Tier => {
  const root = "/inmem"
  const repo = new InMemRepo()
  return {
    root,
    write: (path, content) => repo.writeFile(path, content),
    io: (claude) =>
      inMemoryJudgeIo(root, repo, {
        userFiles: new Map(),
        fetch: undefined,
        claude: claude?.reply,
        calls: [],
      }),
    serve: async ({ status, body }) => {
      let received: Received | undefined
      return {
        url: "http://inmem/",
        io: inMemoryJudgeIo(root, repo, {
          userFiles: new Map(),
          fetch: async (_url, init) => {
            received = {
              headers: Object.fromEntries(new Headers(init?.headers).entries()),
              body: String(init?.body),
            }
            return new Response(body, { status })
          },
          claude: undefined,
          calls: [],
        }),
        received: () => received,
      }
    },
    path: "",
    dispose: () => {},
  }
}

for (const make of [live, inMemory]) {
  describe(`JudgeIo [${make.name}]`, () => {
    let t: Tier
    afterEach(() => t.dispose())

    const callClaude = (io: JudgeIo): Promise<ClaudeOutcome> =>
      io.claude({
        argv: ["-p"],
        stdin: "the prompt",
        env: { PATH: t.path },
        cwd: tmpdir(),
        timeoutMs: 10_000,
      })

    it("reads a file, and an absent one as undefined", async () => {
      t = make()
      t.write("answers.json", "[]")
      const io = t.io()
      expect(await io.readFile(join(t.root, "answers.json"))).toBe("[]")
      expect(await io.readFile(join(t.root, "missing.json"))).toBeUndefined()
    })

    it("posts JSON with the given headers and no trace headers, handing back any status and body", async () => {
      t = make()
      const { url, io, received } = await t.serve({ status: 429, body: "slow down" })
      expect(
        await io.post({
          url,
          headers: { Authorization: "Bearer k" },
          json: "{}",
          timeoutMs: 10_000,
        }),
      ).toEqual({ status: 429, text: "slow down" })
      expect(received()).toMatchObject({
        headers: { authorization: "Bearer k", "content-type": "application/json" },
        body: "{}",
      })
      expect(Object.keys(received()!.headers)).not.toContain("traceparent")
    })

    it("reports claude absent from PATH", async () => {
      t = make()
      expect(await callClaude(t.io())).toEqual({ kind: "missing" })
    })

    it("hands back what claude printed", async () => {
      t = make()
      const io = t.io({
        script: "cat >/dev/null\necho '{\"ok\":true}'",
        reply: { code: 0, stdout: '{"ok":true}\n', stderr: "" },
      })
      expect(await callClaude(io)).toEqual({
        kind: "exited",
        code: 0,
        stdout: '{"ok":true}\n',
        stderr: "",
      })
    })

    it("hands back claude's failing status and stderr", async () => {
      t = make()
      const io = t.io({
        script: "cat >/dev/null\necho 'no login' >&2\nexit 1",
        reply: { code: 1, stdout: "", stderr: "no login\n" },
      })
      expect(await callClaude(io)).toEqual({
        kind: "exited",
        code: 1,
        stdout: "",
        stderr: "no login\n",
      })
    })
  })
}
