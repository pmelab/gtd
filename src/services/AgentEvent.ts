export type AgentEvent =
  | { readonly _tag: "AgentStart" }
  | { readonly _tag: "TurnStart" }
  | { readonly _tag: "TextDelta"; readonly delta: string }
  | { readonly _tag: "TurnEnd"; readonly text: string }
  | { readonly _tag: "ToolStart"; readonly toolName: string }
  | {
      readonly _tag: "ToolEnd"
      readonly toolName: string
      readonly isError: boolean
    }
  | { readonly _tag: "AgentEnd" }

export const AgentEvent = {
  agentStart: (): AgentEvent => ({ _tag: "AgentStart" }),
  turnStart: (): AgentEvent => ({ _tag: "TurnStart" }),
  textDelta: (delta: string): AgentEvent => ({ _tag: "TextDelta", delta }),
  turnEnd: (text: string): AgentEvent => ({ _tag: "TurnEnd", text }),
  toolStart: (toolName: string): AgentEvent => ({ _tag: "ToolStart", toolName }),
  toolEnd: (toolName: string, isError: boolean): AgentEvent => ({
    _tag: "ToolEnd",
    toolName,
    isError,
  }),
  agentEnd: (): AgentEvent => ({ _tag: "AgentEnd" }),
}
