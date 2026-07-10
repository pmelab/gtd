<%~ include("@header") %>

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

### Open questions await the user

`TODO.md` contains one or more `<!-- user answers here -->` markers — unanswered
questions. This is a human gate; there is nothing for you to do.

Tell the user to open `TODO.md`, answer each question inline (replacing its
`<!-- user answers here -->` marker with the answer).

<%~ include(it.tail) %>
