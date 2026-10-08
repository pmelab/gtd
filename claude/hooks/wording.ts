// Everything the mod says to a person. Plain words: no gtd state ids, no tool
// names, and options that say what choosing them does.

import type { Run, Stop } from "../types"
import type { Beat } from "./drive"

export const CONTINUE = "I'm done, continue"
export const SAFE = "Continue with the safe choice"
export const HANDOFF = "Hand off to someone else"
export const LATER = "Not now"
export const SHIP = "Yes, open the pull request"
export const ANYONE = "Anyone on the team"
export const CANCEL = "Cancel"
export const CLOSE = "Close"

export const gateOptions = (stop: Stop) => [stop.isJudge ? SAFE : CONTINUE, HANDOFF, LATER]

const step = (s: { label?: string; state?: string }) => s.label ?? s.state ?? "the next step"

export function question(r: Run) {
  const stop = r.stop as Stop
  if (stop.isJudge) {
    return `gtd can't decide this step on its own: ${step(stop)}. Continue with the safe choice, or hand it to someone who can decide?`
  }
  const how = r.url
    ? `Open it in your browser: ${r.url}`
    : `Make your changes in ${stop.file ?? "the files it names"}.`
  const again = r.isRepeat ? "You haven't changed anything yet, so gtd is still waiting. " : ""
  return `${again}gtd needs your input: ${step(stop)}. ${how} Ready to continue?`
}

export const STALE =
  "This question is out of date: gtd has already moved on. Choose Close to dismiss it."

export const RELOAD_CUT_SCRIPT =
  "a reload cut a script off mid-run — check the working tree, then Continue to run it again"

export const handoffQuestion =
  "Who should take over from here? Type their GitHub username, or let anyone on the team pick it up."

export const shipQuestion = (branch: string) =>
  `gtd has finished the work on ${branch}. Combine it into a single commit and open (or update) its pull request for review?`

export function headline(s: Stop) {
  const where = step(s)
  switch (s.kind) {
    case "gate":
      return `● needs your input — ${where}`
    case "done":
      return `✔ done — ${s.label ?? "nothing left to do"}`
    case "stopped":
      return `■ ${s.text}`
    case "stalled":
      return `✘ stuck — ${where}`
    default:
      return `✘ something went wrong — ${where}`
  }
}

export const TONE: Record<Stop["kind"], string> = {
  error: "red",
  stalled: "red",
  done: "green",
  gate: "yellow",
  stopped: "yellow",
}

// The band while a step runs, in the shape of Claude's own spinner line,
// `✳ Thinking… (12s · …)`, which herdr reads as working. The "… (<n>[smh] ·"
// part is what its rule needs: the band row ends in the engine's own toggle.
export function runningLine(label: string, beat: number, elapsedMs: number) {
  const s = Math.max(0, Math.floor(elapsedMs / 1000))
  const took = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
  return `✳ gtd ▸ ${label}… (${took} · step ${beat})`
}

// One line per beat, for the status line and the transcript.
export const beatLine = (beat: number, b: Beat) => `▸ ${step(b)} · step ${beat}`

export const restartLine = (scope: string) =>
  `${scope}: skills or system changed — started a fresh subagent`

// What a push to a phone says when gtd stops: the step, and where to act on it.
export function pushText(stop: Stop, repo: string, url?: string) {
  const at = `${repo}: ${headline(stop).replace(/^\S+ /, "")}`
  if (stop.kind !== "gate") return at
  return url ? `${at}. Open: ${url}` : at
}
