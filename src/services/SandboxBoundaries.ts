export type BoundaryLevel = "restricted" | "standard" | "elevated"

export const BOUNDARY_LEVELS: ReadonlyArray<BoundaryLevel> = ["restricted", "standard", "elevated"]

export type WorkflowPhase = "plan" | "build" | "learn"

export const boundaryForPhase = (phase: WorkflowPhase): BoundaryLevel => {
  switch (phase) {
    case "plan":
      return "restricted"
    case "build":
      return "standard"
    case "learn":
      return "restricted"
  }
}

export const shouldEscalate = (current: BoundaryLevel, target: BoundaryLevel): boolean => {
  const currentIndex = BOUNDARY_LEVELS.indexOf(current)
  const targetIndex = BOUNDARY_LEVELS.indexOf(target)
  return targetIndex > currentIndex
}

export const escalateBoundary = (current: BoundaryLevel): BoundaryLevel => {
  const currentIndex = BOUNDARY_LEVELS.indexOf(current)
  const nextIndex = Math.min(currentIndex + 1, BOUNDARY_LEVELS.length - 1)
  return BOUNDARY_LEVELS[nextIndex]!
}
