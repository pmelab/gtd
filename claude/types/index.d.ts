export type Stop = {
  kind: "gate" | "stalled" | "done" | "error" | "stopped"
  text: string
  state?: string
  label?: string
  isJudge?: boolean
  // the steering file the rest asks a person to edit
  file?: string
  // the steering file's mode (`qa`, `review`), which bounds what may be written at the rest
  mode?: string
}

export type Run = {
  isRunning: boolean
  beat: number
  state?: string
  label?: string
  stop?: Stop
  // the rest a person is helped at: HEAD and state, so an answer to an older one is refused
  rest?: string
  // a continue the model asked for, started once its turn ends (and only if
  // gtd still rests at `rest`); kept here so a reload does not lose a verdict
  pending?: { rest: string; isAnswered?: boolean; verdict?: string | undefined }
  // requests a person made while a step ran, for the next rest's assistant
  notes?: string[]
  // `gtd ui`'s address while it serves the current rest
  url?: string
  // why `gtd ui` is not serving it (refused, crashed)
  uiNote?: string
  // the same gate came back with nothing landed since
  isRepeat?: boolean
  // the agent turn in flight, so a reload can land it instead of repeating it
  inflight?: { agentId: string; memory: string }
  // a script (beat or landing) is running, so a reload must not run it again
  isScripting?: boolean
}

declare module "claude-code" {
  interface PluginState {
    gtd: {
      run: Run
      scopes: Record<string, { agentId: string; persona: string }>
      agents: string[]
    }
  }
}
