<%
  const ctx = it.context
  const fF = it.fenceFor
  const lines = ["## Context", ""]
  lines.push(ctx.lastCommitSubject === "" ? "Last commit: _(repository has no commits yet)_" : "Last commit: `" + ctx.lastCommitSubject + "`")
  lines.push("Working tree: " + (ctx.workingTreeClean ? "clean" : "dirty"))
  if (ctx.packages.length > 0) {
    lines.push("", "### Work packages in `.gtd/`", "")
    for (const pkg of ctx.packages) {
      lines.push("- `" + pkg.name + "/`")
      for (const task of pkg.tasks) lines.push("  - `" + task + "`")
    }
  }
  if (ctx.diff !== "") {
    const body = ctx.diff.replace(/\n$/, "")
    const fence = fF(body)
    lines.push("", "### Working-tree diff (`git diff HEAD`, untracked included)", "", fence + "diff", body, fence, "")
  }
%><%~ lines.join("\n") + "\n" %>
