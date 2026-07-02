# Plan

## Issue #31 — grilling must always rewrite TODO.md into a concrete plan

### Problem

When the grilling subagent judges a feature fully specified, it can converge
(write the `no open questions — run gtd to plan` sentinel) while leaving
`TODO.md` still holding only the seed "Captured input" template + embedded diff.
Convergence signals _readiness to decompose_, not permission to skip planning —
so decomposition then runs against an empty plan.

### Root cause

`src/prompts/grilling.md` iterate tail ("Develop the plan", lines 24-51) never
instructs the subagent to develop the captured input into a concrete plan body.
Its steps only cover (1) integrating answers, (2) interviewing for questions,
(3) writing new questions, (4) writing the sentinel when resolved. Nothing says
"the plan body itself must become a concrete implementation plan", so a subagent
that finds no open questions writes the sentinel over the untouched seed.

### The change

Edit **only** `src/prompts/grilling.md`. This is a bundled static markdown
prompt (imported in `src/Prompt.ts` as `grillingMd`, split on the
`<!-- gtd:iterate -->` / `<!-- gtd:stop -->` delimiters). The fix is prompt-text
only — no TypeScript logic changes.

Make it explicit in the iterate tail that developing the plan body is mandatory
and independent of whether questions exist. Three concrete edits:

1. **Add a first step that mandates rewriting the plan body.** Insert a new step
   at the top of the numbered "Develop the plan" list (before the current step 1
   about integrating answers), reading approximately:

   > 1. **Always develop `TODO.md` into a concrete plan.** Replace the captured
   >    input / seed template with a real implementation plan — the files to
   >    change, exactly what changes, and why — grounded in the codebase. Do
   >    this on every iteration, whether or not any questions remain open. A
   >    plan that still contains only the seed "Captured input" block is never
   >    ready to converge.

   Renumber the existing steps 1-4 to 2-5 accordingly (sub-bullets stay under
   their renumbered parents).

2. **Reinforce the convergence rule at the sentinel step.** Amend the current
   final step ("If the plan is now fully resolved…", lines 46-47) to read
   approximately:

   > If the plan is now fully resolved, leave **no** markers and write the
   > sentinel `no open questions — run gtd to plan` instead. Only write the
   > sentinel once `TODO.md` holds a concrete plan — the sentinel signals the
   > plan is ready to decompose, not that planning can be skipped.

3. **Tie the sentinel to a developed plan in the "convergence marker" section**
   near the top (after line 20), adding a sentence such as:

   > The sentinel means the plan is fully developed and ready to decompose — it
   > is never a substitute for writing the plan.

### Tests

No cucumber scenario is warranted: this is a prompt-wording change, not a code
behavior change with an observable state transition. Existing
`src/Prompt.test.ts` assertions rely on stable substrings this edit preserves:

- `"Develop the plan"` (iterate tail heading — checks at lines 262/269)
- `"no open questions — run gtd to plan"` (both-tails check, line 250)
- ``"Grill the plan in `TODO.md`"`` (base heading)

### Verification

Confirm the existing suite still passes (`src/Prompt.test.ts` grilling
assertions need no update). Optionally build the prompt with
`grillingCase: "iterate"` and eyeball that the rendered iterate tail now leads
its "Develop the plan" list with the mandatory concrete-plan step.

no open questions — run gtd to plan
