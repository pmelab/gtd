<%
  const body = it.decisionLog.replace(/\n$/, "")
  const fence = it.fenceFor(body)
  const out = [
    "",
    "### Prior decisions",
    "",
    "Settled in earlier cycles (`.gtd/DECISIONS.md`) — don't re-ask one of these" +
      " unless the codebase now genuinely contradicts it; if you do override one," +
      " make that explicit rather than silently disagreeing.",
    "",
    fence,
    body,
    fence,
    "",
  ].join("\n")
%><%~ out %>
