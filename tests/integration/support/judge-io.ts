import type { JudgeIo } from "../../../src/judges/index.js"
import type { InMemRepo } from "../../../src/twins/index.js"

/** What a scripted `claude` prints and exits with. */
export interface ScriptedClaude {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * The judge's file reads, network and `claude` calls, answered in memory:
 * files from the repository rooted at `root` or from `userFiles`, the network from `fetch` when a
 * scenario stubs it, and `claude` from `claude` when one is scripted — absent
 * from PATH otherwise. Every `claude` argv is recorded in `calls`.
 */
export const inMemoryJudgeIo = (
  root: string,
  repo: InMemRepo,
  options: {
    /** Files outside the repository, by absolute path — the user-level config. */
    readonly userFiles: ReadonlyMap<string, string>
    readonly fetch: typeof fetch | undefined
    readonly claude: ScriptedClaude | undefined
    readonly calls: string[][]
  },
): JudgeIo => ({
  readFile: async (path) => {
    const relative = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
    return relative.startsWith("/") ? options.userFiles.get(relative) : repo.readFile(relative)
  },
  post: async ({ url, headers, json }) => {
    if (options.fetch === undefined) throw new Error("fetch failed: no network in memory")
    const res = await options.fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: json,
    })
    return { status: res.status, text: await res.text() }
  },
  claude: async ({ argv }) => {
    if (options.claude === undefined) return { kind: "missing" }
    options.calls.push([...argv])
    return { kind: "exited", ...options.claude }
  },
})
