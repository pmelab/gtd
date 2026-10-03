export type Stop = {
  kind: "gate" | "stalled" | "done" | "error" | "stopped"
  text: string
  state?: string
  label?: string
  isJudge?: boolean
}

export type Run = {
  isRunning: boolean
  beat: number
  state?: string
  label?: string
  stop?: Stop
  // `gtd ui`'s address while it serves the current rest
  url?: string
  // why `gtd ui` is not serving it (refused, crashed)
  uiNote?: string
  // the same gate came back with nothing landed since
  isRepeat?: boolean
}

declare module "claude-code" {
  interface PluginState {
    gtd: { run: Run; scopes: Record<string, string>; agents: string[] }
  }
}
