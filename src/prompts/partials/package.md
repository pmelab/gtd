<%
  const lines = ["", "### Package: `" + it.pkg.name + "/`", ""]
  for (const task of it.pkg.taskContents) {
    const fence = it.fenceFor(task.content)
    lines.push("#### `" + task.name + "`", "", fence, task.content.replace(/\n$/, ""), fence, "")
  }
%><%~ lines.join("\n") %>
