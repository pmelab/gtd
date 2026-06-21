feat(events): add edge-IO event gathering layer

Add `GitService.commitSubjects(base?)` (first-parent, oldest→newest, whole-history
fallback) and `src/Events.ts#gatherEvents()` that probes git + working tree and
emits the typed COMMIT/RESOLVE stream the machine folds. Relocate
`computeReviewBase` into `Events.ts`. All IO now lives at the edge.
