refactor(gtd): cut over to the pure 16-state resolver

Hard cutover to the STATES.md design. Replaces the 18-state xstate actor with a
pure resolve() precedence ladder + two counter folds, rewrites the edge to the
flat gtd: taxonomy with name-status removedErrors detection, renders one prompt
section per state, drives the loop over resolve() + edgeActions, drops the
commit-intent / spec-review / COMMIT_MSG / checkbox / trailer machinery and the
xstate dependency, and rewrites the unit + cucumber suites to the 16 states.
