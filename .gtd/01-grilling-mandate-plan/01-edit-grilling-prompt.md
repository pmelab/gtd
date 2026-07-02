# Task: Grilling prompt must mandate developing a concrete plan

## Context

When the grilling subagent judges a feature fully specified, it can converge
(write the `no open questions — run gtd to plan` sentinel) while leaving
`TODO.md` still holding only the seed "Captured input" template. Convergence
signals _readiness to decompose_, not permission to skip planning — so
decomposition then runs against an empty plan.

Root cause: the `src/prompts/grilling.md` iterate tail ("Develop the plan")
never instructs the subagent to develop the captured input into a concrete plan
body. Its steps only cover integrating answers, interviewing, writing questions,
and writing the sentinel.

This is a **prompt-text-only** change. No TypeScript logic changes. The file is
a bundled static markdown prompt imported in `src/Prompt.ts` as `grillingMd`,
split on the `<!-- gtd:iterate -->` / `<!-- gtd:stop -->` delimiters.

## File to edit

- `src/prompts/grilling.md` (the ONLY file to change)

## The three edits

### Edit 1 — mandate rewriting the plan body (top of "Develop the plan" list)

Insert a new step at the top of the numbered "Develop the plan" list, before the
current step 1 (about integrating answers). It should read approximately:

> 1. **Always develop `TODO.md` into a concrete plan.** Replace the captured
>    input / seed template with a real implementation plan — the files to
>    change, exactly what changes, and why — grounded in the codebase. Do this
>    on every iteration, whether or not any questions remain open. A plan that
>    still contains only the seed "Captured input" block is never ready to
>    converge.

Renumber the existing steps 1–4 to 2–5. Sub-bullets stay under their renumbered
parents.

### Edit 2 — reinforce the convergence rule at the sentinel step

Amend the current final step ("If the plan is now fully resolved, leave **no**
markers and write the sentinel `no open questions — run gtd to plan` instead.")
to read approximately:

> If the plan is now fully resolved, leave **no** markers and write the sentinel
> `no open questions — run gtd to plan` instead. Only write the sentinel once
> `TODO.md` holds a concrete plan — the sentinel signals the plan is ready to
> decompose, not that planning can be skipped.

(This is the renumbered step 5 after Edit 1.)

### Edit 3 — tie the sentinel to a developed plan in the "convergence marker" section

In the "The convergence marker" section near the top (after the paragraph ending
"the next gtd run advances the plan to decomposition."), add a sentence:

> The sentinel means the plan is fully developed and ready to decompose — it is
> never a substitute for writing the plan.

## Constraints

- Edit `src/prompts/grilling.md` ONLY. No changes to `src/Prompt.ts`,
  `src/Prompt.test.ts`, or any other file.
- Preserve these exact stable substrings that `src/Prompt.test.ts` asserts:
  - `Develop the plan` (iterate-tail heading — must stay, must remain absent
    from the stop tail)
  - `no open questions — run gtd to plan` (must stay in both tails; note the em
    dash `—`, not a hyphen)
  - ``Grill the plan in `TODO.md` `` (base heading)
- Do NOT move edits across the `<!-- gtd:iterate -->` / `<!-- gtd:stop -->`
  delimiters — Edits 1 & 2 land inside the iterate tail (between those
  delimiters), Edit 3 lands before `<!-- gtd:iterate -->`.
- No cucumber scenario is warranted — this is a prompt-wording change, not a
  code behavior change with an observable state transition.

## Acceptance criteria

- [ ] `src/prompts/grilling.md` iterate tail's "Develop the plan" numbered list
      leads with a mandatory "Always develop `TODO.md` into a concrete plan"
      step; the four prior steps are renumbered 2–5.
- [ ] The sentinel step now states the sentinel is only written once `TODO.md`
      holds a concrete plan.
- [ ] The "convergence marker" section states the sentinel is never a substitute
      for writing the plan.
- [ ] The stable substrings above are all preserved verbatim.
- [ ] Only `src/prompts/grilling.md` is modified.

## Verification

- [ ] `npx vitest run src/Prompt.test.ts` passes (grilling assertions need no
      update).
- [ ] Optionally: render the prompt with `grillingCase: "iterate"` and confirm
      the "Develop the plan" list leads with the mandatory concrete-plan step.
