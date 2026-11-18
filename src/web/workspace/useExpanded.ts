import { useState } from "react"
import { attentionCount, type ProjectView } from "./view.js"

/**
 * Each project's expand state, by id. A project starts expanded when a
 * worktree needs attention the first time it is seen; refreshes after that
 * leave it as it is, and only a toggle changes it.
 */
export const useExpanded = (projects: readonly ProjectView[]) => {
  const [expanded, setExpanded] = useState<Readonly<Record<string, boolean>>>({})
  const unseen = projects.filter((project) => !(project.id in expanded))
  if (unseen.length > 0) {
    setExpanded({
      ...Object.fromEntries(unseen.map((project) => [project.id, attentionCount(project) > 0])),
      ...expanded,
    })
  }
  const toggle = (project: string, value: boolean) => {
    setExpanded((current) => ({ ...current, [project]: value }))
  }
  return [expanded, toggle] as const
}
