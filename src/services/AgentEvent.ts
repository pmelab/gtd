export type AgentEvent =
  | { readonly _tag: "AgentStart" }
  | { readonly _tag: "TurnStart" }
  | { readonly _tag: "TextDelta"; readonly delta: string }
  | { readonly _tag: "ThinkingDelta"; readonly delta: string }
  | { readonly _tag: "TurnEnd"; readonly text: string }
  | { readonly _tag: "ToolStart"; readonly toolName: string; readonly toolInput?: unknown }
  | {
      readonly _tag: "ToolEnd"
      readonly toolName: string
      readonly isError: boolean
      readonly toolOutput?: string
    }
  | { readonly _tag: "AgentEnd" }
  | { readonly _tag: "Activity" }

export const AgentEvents = {
  agentStart: (): AgentEvent => ({ _tag: "AgentStart" }),
  turnStart: (): AgentEvent => ({ _tag: "TurnStart" }),
  textDelta: (delta: string): AgentEvent => ({ _tag: "TextDelta", delta }),
  thinkingDelta: (delta: string): AgentEvent => ({ _tag: "ThinkingDelta", delta }),
  turnEnd: (text: string): AgentEvent => ({ _tag: "TurnEnd", text }),
  toolStart: (toolName: string, toolInput?: unknown): AgentEvent => ({
    _tag: "ToolStart",
    toolName,
    toolInput,
  }),
  toolEnd: (toolName: string, isError: boolean, toolOutput?: string): AgentEvent => {
    const event: { _tag: "ToolEnd"; toolName: string; isError: boolean; toolOutput?: string } = {
      _tag: "ToolEnd",
      toolName,
      isError,
    }
    if (toolOutput !== undefined) event.toolOutput = toolOutput
    return event
  },
  agentEnd: (): AgentEvent => ({ _tag: "AgentEnd" }),
  activity: (): AgentEvent => ({ _tag: "Activity" }),
}
