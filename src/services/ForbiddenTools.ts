export type AgentProviderType = "pi" | "opencode" | "claude"

// Complete catalog of known tool names for each agent provider.
// Sourced from each agent's SDK/source code. Used for validation
// and snapshot tests to catch when upstream adds new tools.
//
// Pi tools:
//   Built-in tools from pi-coding-agent README.
//   Default: read, bash, edit, write. Optional: grep, find, ls.
//   Pi has no built-in interactive tool — user interaction happens
//   via the chat UI, not a tool call. Extensions may add custom tools
//   but those are project-specific and not enumerable here.
//
// OpenCode tools:
//   From opencode source (packages/opencode/src/tool/registry.ts).
//   The "question" tool is interactive — it prompts the user for answers.
//   Some tools are conditional (codesearch, websearch, lsp, batch,
//   plan_enter, plan_exit, apply_patch) but can all appear in tool_call events.
//
// Claude tools:
//   From @anthropic-ai/claude-agent-sdk sdk-tools.d.ts ToolInputSchemas union.
//   "AskUserQuestion" is the interactive tool — it presents the user with
//   a question and multiple-choice options.
export const AGENT_TOOL_CATALOG: Record<AgentProviderType, ReadonlyArray<string>> = {
  pi: ["read", "bash", "edit", "write", "grep", "find", "ls"],

  opencode: [
    "bash",
    "read",
    "glob",
    "grep",
    "edit",
    "write",
    "task",
    "webfetch",
    "todowrite",
    "todoread",
    "websearch",
    "codesearch",
    "skill",
    "apply_patch",
    "lsp",
    "batch",
    "plan_enter",
    "plan_exit",
    "question",
    "multiedit",
  ],

  claude: [
    "Agent",
    "Bash",
    "TaskOutput",
    "ExitPlanMode",
    "FileEdit",
    "FileRead",
    "FileWrite",
    "Glob",
    "Grep",
    "TaskStop",
    "ListMcpResources",
    "Mcp",
    "NotebookEdit",
    "ReadMcpResource",
    "TodoWrite",
    "WebFetch",
    "WebSearch",
    "AskUserQuestion",
    "Config",
  ],
}

// Per-agent lists of tools that require user interaction and must be
// blocked in non-interactive (headless/CI) mode. These are hardcoded
// safety invariants — users cannot override them via configuration.
//
// Classification criteria: a tool is "interactive" if it suspends
// execution waiting for user input that cannot be provided programmatically.
export const FORBIDDEN_TOOLS: Record<AgentProviderType, ReadonlyArray<string>> = {
  // Pi: no built-in interactive tools. The chat UI handles interaction
  // outside the tool protocol. Extensions could theoretically add
  // interactive tools but those are not enumerable statically.
  pi: [],

  // OpenCode: "question" tool prompts the user for answers via the TUI
  // or CLI. In headless `opencode run` mode this would hang indefinitely.
  opencode: ["question"],

  // Claude: "AskUserQuestion" presents multiple-choice questions to the user.
  // In non-interactive mode (--dangerously-skip-permissions, piped stdin)
  // this tool call cannot be answered.
  claude: ["AskUserQuestion"],
}
