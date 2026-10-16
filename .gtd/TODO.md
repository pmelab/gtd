Implement pmelab/gtd#355: Dogfood: ship one real feature through the new
workflow ## Goal Ship a small, genuinely composable feature in gtd itself (e.g.
a provider swap in judge) through the full workflow: flag registry, dual-state
tests, rollout, cleanup commit. ## Acceptance - Flag lands, rolls out, and is
removed again in separate commits - Trailers for every gate present in history -
Notes on friction filed as follow-up issues Depends on #354
