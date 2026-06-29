## Task: Grill the plan in `TODO.md`

`TODO.md` holds the plan under development. The grilling loop interviews it —
surfacing and resolving open questions — until the plan is solid enough to
decompose into work packages.

### The convergence marker

Every open question carries a single placeholder comment on its own line,
directly beneath the question:

`<!-- user answers here -->`

This placeholder is the **convergence marker**. While _any_ marker is present in
`TODO.md`, gtd **stops** and waits for the user to answer inline. When there are
genuinely no open questions left, write the sentinel line

`no open questions — run gtd to plan`

and leave **no** markers — the next gtd run advances the plan to decomposition.

<!-- gtd:iterate -->

### Develop the plan

Spawn a **planning-model subagent** using model `{{MODEL}}` to develop the plan.
The subagent works entirely by editing `TODO.md` (it cannot talk to the user):

1. For every question the user has just answered (the answer written in place of
   its `<!-- user answers here -->` marker): integrate the answer into the plan
   body, then move the question into a `## Resolved` section at the bottom,
   recording the user's response as `**Answer:** …`.
2. Continue interviewing the plan with this discipline:
   - **Explore before asking** — if the codebase or docs answer it, explore
     instead of asking.
   - **Prioritize high-stakes questions** — hard-to-reverse decisions before
     easy-to-change ones.
   - **Walk branches completely** — group related questions so the user can
     resolve one branch fully before the next.
   - **Every question advances a decision** — never ask something that would not
     change the implementation.
   - Every answer opens new branches; generate fresh questions for any ambiguity
     the answers surface.
3. Write each new open question near the top of the file, each followed on its
   own line by the `<!-- user answers here -->` marker.
4. If the plan is now fully resolved, leave **no** markers and write the
   sentinel `no open questions — run gtd to plan` instead.

Normalize formatting (run `gtd format TODO.md` with the same gtd you invoked),
then leave `TODO.md` **uncommitted** — the next gtd run commits it
`gtd: grilling` and re-derives.

<!-- gtd:stop -->

### Open questions await the user

`TODO.md` contains one or more `<!-- user answers here -->` markers — unanswered
questions. This is a human gate; there is nothing for you to do.

Tell the user to open `TODO.md`, answer each question inline (replacing its
`<!-- user answers here -->` marker with the answer), and re-run gtd. Then
**STOP** — do not edit `TODO.md`, spawn a subagent, or re-run gtd yourself. The
user must answer first.
