<%~ include("@header") %>

`REVIEW.md` holds the review record for the completed work. This is a human
gate; there is nothing for the agent to do.

Tell the user:

- Read `REVIEW.md` (and the underlying work it points at).
- To **approve**: run `gtd step` with no edits, or only tick checkboxes in
  `REVIEW.md` — either way ends the review with an approval.
- To **request changes**: write substantive edits or annotations into
  `REVIEW.md` (or the code) describing what's wrong, then run `gtd step` —
  this sends the feedback back for another round.

<% if (it.tail) { %>
<%~ include(it.tail) %>
<% } %>
