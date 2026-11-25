import { basename } from "node:path"
import type { Worktree, WorktreesAdapter } from "../workspace/index.js"

/** A worktree's name in its gate page's path: its directory, whatever its branch. */
const nameOf = (worktree: Pick<Worktree, "path">): string => basename(worktree.path)

/** `/<project>/<worktree>/gate`, each part one path segment. */
export const gatePath = (project: string, worktree: Pick<Worktree, "path">): string =>
  `/${encodeURIComponent(project)}/${encodeURIComponent(nameOf(worktree))}/gate`

const GATE = /^(\/([^/]+)\/([^/]+)\/gate)(?:\/|$)/

/** The path is a gate page's or its API's; a project may be named `trpc`. */
export const isGatePath = (pathname: string): boolean => GATE.test(pathname)

const decode = (segment: string): string | undefined => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}

/** The worktree a request path's gate page belongs to, with the page's own path. */
export const gateOf = async (
  pathname: string,
  worktrees: WorktreesAdapter,
): Promise<{ readonly base: string; readonly worktree: Worktree } | undefined> => {
  const match = GATE.exec(pathname)
  if (match === null) return undefined
  const [, base, project, name] = match as unknown as [string, string, string, string]
  const projectId = decode(project)
  if (projectId === undefined) return undefined
  if (!(await worktrees.projects()).some((p) => p.id === projectId)) return undefined
  const worktree = (await worktrees.list(projectId)).find((w) => nameOf(w) === decode(name))
  return worktree === undefined ? undefined : { base, worktree }
}
