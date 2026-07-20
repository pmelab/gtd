<%
  const body = it.decisionLog.replace(/\n$/, "")
  const fence = it.fenceFor(body)
  const out = [
    "",
    "### Prior decisions",
    "",
    "Recorded in past squash commits, oldest to newest, with no deduplication" +
      " — if two entries answer the same question differently, the LATER one" +
      " (further down) is the current, authoritative answer. Don't re-ask a" +
      " settled question unless the codebase now genuinely contradicts it.",
    "",
    fence,
    body,
    fence,
    "",
  ].join("\n")
%><%~ out %>
