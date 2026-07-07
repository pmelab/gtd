<%
  const body = it.diff.replace(/\n$/, "")
  const fence = it.fenceFor(body)
  const out = ["", "### " + it.heading, "", fence + "diff", body, fence, ""].join("\n")
%><%~ out %>
