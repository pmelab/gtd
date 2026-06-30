# Review: 0ef430b

<!-- base: 0ef430b1bd04d1f5e1c69d08a22a9fede7ba3f04 -->

## Fix: delete TODO.md when closing the last package

`closePackage` previously left TODO.md in place after `gtd: package done` closed
the final package. With `.gtd` gone but TODO.md still present, the next run hit
rule 6 (TODO.md present → Grilling) and re-entered the Grilling loop forever.
Now, when `packages.length <= 1`, it removes TODO.md (after `removePackageDir`,
before `commitAllWithPrefix`) so the next run falls through to rule 7
(Clean/Idle). The doc comment is updated to note the last-package removal.

- [ ] ./src/Events.ts#387
- [ ] ./src/Events.ts#379

## Tests: assert TODO.md lifecycle on close

The single-package close test now seeds a TODO.md and asserts it is deleted,
untracked, and the tree is clean. The two-package close test seeds a TODO.md and
asserts it survives (only the first package dir is removed).

- [ ] ./src/Events.test.ts#529
- [ ] ./src/Events.test.ts#548

## Docs: STATES.md close-package actions

Close package "Actions" now documents the last-package TODO.md removal and the
rule 6 vs rule 7 rationale.

- [ ] ./STATES.md#276

## Resolved

<!-- resolved items move here as the user works through the review -->
