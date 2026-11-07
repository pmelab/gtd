export type Ran = { code: number; out: string; err: string }

export type GitIo = {
  // argv runs in the repository root; stdin is the child's whole input
  run(argv: string[], stdin?: string): Promise<Ran>
  log(line: string): void
}

export type Done = { ok: boolean; text: string }

// A rejection becomes `killed`, so the caller can tell a timeout from a refused
// push. Relies on the host's process runner rejecting at its timeout; a spawn
// failure lands here too. Only pushes: any other crashed read must abort, not
// pass as an answer.
const attempt = async (io: GitIo, argv: string[]): Promise<Ran & { killed: boolean }> => {
  try {
    return { ...(await io.run(argv)), killed: false }
  } catch (err) {
    return { code: 1, out: "", err: err instanceof Error ? err.message : String(err), killed: true }
  }
}

export async function defaultBranch(git: (...args: string[]) => Promise<string>) {
  const head = await git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
  return head.replace(/^origin\//, "") || "main"
}

// A pull request describes what the remote branch holds. A rewritten branch
// needs --force-with-lease on an existing origin/<branch>. `fresh`: origin
// lacks the branch, so any tracking ref is stale. Returns why the push failed,
// or nothing.
export async function pushBranch(io: GitIo, branch: string, fresh = false) {
  const ok = async (...args: string[]) => (await io.run(["git", ...args])).code === 0
  const push = async (args: string[], failure: string) => {
    const r = await attempt(io, ["git", "push", ...args])
    if (r.killed)
      return `git push of ${branch} did not finish; nothing was lost. Retry without fetching.\n${r.err}`.trimEnd()
    if (r.code !== 0) return `${failure}\n${r.err}`.trimEnd()
    return undefined
  }
  if (fresh || !(await ok("rev-parse", "--verify", "--quiet", `origin/${branch}`))) {
    io.log(`Pushing ${branch} to origin…`)
    return push(["--set-upstream", "origin", branch], "git push failed.")
  }
  if (!(await ok("merge-base", "--is-ancestor", "HEAD", `origin/${branch}`))) {
    io.log(`Pushing ${branch} to origin…`)
    return push(
      ["--force-with-lease", "origin", branch],
      `git push failed: origin/${branch} moved. Fetch and reconcile first.`,
    )
  }
  return undefined
}

// Marks a draft pull request `/gtd throw` opened for a hand-off.
export const THROWN = "<!-- gtd:thrown -->"
