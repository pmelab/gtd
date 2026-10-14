import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { liveJudgeIo, type ClaudeOutcome, type JudgeIo } from "../../src/judges/index.js"
import { InMemRepo } from "../../src/testkit/index.js"
import { inMemoryJudgeIo, type ScriptedClaude } from "../integration/support/judge-io.js"

// The judge's file reads and `claude` calls, live and in memory, held to the
// same answers — what lets every judge scenario run in-process. Each case
// states what `claude` does once: a shell script for the live tier, a
// scripted reply for the in-memory one.
interface Claude {
  readonly script: string
  readonly reply: ScriptedClaude
}

interface Tier {
  readonly root: string
  readonly write: (path: string, content: string) => void
  readonly io: (claude?: Claude) => JudgeIo
  /** The PATH `claude` is looked up on. */
  readonly path: string
  readonly dispose: () => void
}

const live = (): Tier => {
  const root = mkdtempSync(join(tmpdir(), "gtd-judge-io-"))
  const bin = mkdtempSync(join(tmpdir(), "gtd-judge-io-bin-"))
  return {
    root,
    write: (path, content) => writeFileSync(join(root, path), content),
    io: (claude) => {
      if (claude !== undefined) {
        writeFileSync(join(bin, "claude"), `#!/bin/sh\n${claude.script}\n`)
        chmodSync(join(bin, "claude"), 0o755)
      }
      return liveJudgeIo
    },
    path: `${bin}:/bin:/usr/bin`,
    dispose: () => {
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

    it("reads a file, and rejects an absent one with ENOENT", async () => {
      t = make()
      t.write("answers.json", "[]")
      const io = t.io()
      expect(await io.readFile(join(t.root, "answers.json"))).toBe("[]")
      await expect(io.readFile(join(t.root, "missing.json"))).rejects.toMatchObject({
        code: "ENOENT",
      })
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
