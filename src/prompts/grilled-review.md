<%~ include("@header") %>

<%~ include("@context", { context: it.context, fenceFor: it.fenceFor }) %> The
plan in `TODO.md` has converged — no open questions remain — and has been
committed as `gtd: grilled`.

### Human review gate

This is a human review point. Tell the user to open `TODO.md` and review the
finalized plan:

- To **proceed**, continue with a clean working tree — the plan will be
  decomposed into `.gtd/` work packages.
- To **revise**, edit `TODO.md` (or sketch code) and continue — the changes
  re-enter the grilling loop for another convergence round.

<%~ include(it.tail) %>
