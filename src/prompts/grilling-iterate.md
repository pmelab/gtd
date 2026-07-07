<%~ include("@header") %>

<%~ include("@context", { context: it.context, fenceFor: it.fenceFor }) %>
`TODO.md` holds the plan under development. The grilling loop interviews it —
surfacing and resolving open questions — until the plan is solid enough to
decompose into work packages.

### The convergence marker

Every open question carries a single placeholder comment on its own line,
directly beneath the question:

`<!-- user answers here -->`

This placeholder is the **convergence marker**. While _any_ marker is present in
`TODO.md`, the harness **stops** and waits for the user to answer inline. When
there are genuinely no open questions left, write the sentinel line

`no open questions — ready to plan`

and leave **no** markers — the next cycle advances the plan to decomposition.
The sentinel means the plan is fully developed and ready to decompose — it is
never a substitute for writing the plan.

### Develop the plan

Spawn a **planning-model subagent** using model `<%= it.model %>` to develop the plan.
The subagent works entirely by editing `TODO.md` (it cannot talk to the user):

1. **Always develop `TODO.md` into a concrete plan.** Replace the captured input
   / seed template with a real implementation plan — the files to change,
   exactly what changes, and why — grounded in the codebase. Do this on every
   iteration, whether or not any questions remain open. A plan that still
   contains only the seed "Captured input" block is never ready to converge.
2. **Read any "Captured input" diff block as feedback, not finished work:** code
   changes are suggestions — fold them into the plan and re-implement them
   properly, including test coverage, rather than restoring them verbatim; code
   comments are positional feedback about the code at that location;
   TODO.md/REVIEW.md text changes are global feedback on the plan or the
   reviewed work as a whole; checkbox flips in a captured REVIEW.md diff are
   approval noise — ignore them. the harness has already reverted captured code
   from the working tree.
3. For every question the user has just answered (the answer written in place of
   its `<!-- user answers here -->` marker): integrate the answer into the plan
   body, then move the question into a `## Resolved` section at the bottom,
   recording the user's response as `**Answer:** …`.
4. Continue interviewing the plan with this discipline:
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
5. Write each new open question near the top of the file, each followed on its
   own line by the `<!-- user answers here -->` marker.
6. If the plan is now fully resolved, leave **no** markers and write the
   sentinel `no open questions — ready to plan` instead. Only write the sentinel
   once `TODO.md` holds a concrete plan — the sentinel signals the plan is ready
   to decompose, not that planning can be skipped.

Leave `TODO.md` **uncommitted** — the next cycle commits it `gtd: grilling` and
re-derives.

<%~ include(it.tail) %>
