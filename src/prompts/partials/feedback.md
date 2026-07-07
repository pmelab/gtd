<%
  const body = it.content.replace(/\n$/, "")
  const fence = it.fenceFor(body)
  const out = ["", "### Feedback to address", "", fence, body, fence, ""].join("\n")
%><%~ out %>
