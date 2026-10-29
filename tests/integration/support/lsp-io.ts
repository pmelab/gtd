import type { LspIo } from "../../../src/lsp/index.js"
import type { InMemRepo } from "../../../src/twins/index.js"

export interface GtdRun {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** The LSP's git and gtd reads, answered from an in-memory repository rooted at `root` and a gtd run in-process. */
export const inMemoryLspIo = (
  root: string,
  repo: InMemRepo,
  gtd: (...args: string[]) => Promise<GtdRun>,
): LspIo => ({
  cwd: root,
  topLevel: async (dir) => {
    if (dir === root || dir.startsWith(`${root}/`)) return root
    throw new Error(`fatal: not a git repository: ${dir}`)
  },
  head: async () => {
    const head = repo.resolveRef("HEAD")
    if (head === null) throw new Error("fatal: ambiguous argument 'HEAD'")
    return head
  },
  next: async () => {
    const result = await gtd("next", "--json")
    if (result.exitCode !== 0) throw new Error(result.stderr.trim())
    return result.stdout
  },
})
