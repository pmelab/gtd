// Everything the mod itself shows a person. Plain words: no gtd state ids.

import type { Stop } from "../types"
import type { Beat } from "./drive"
import type { Shipped } from "./ship"
import { JOB_NAME } from "./tools"
import type { JobName } from "./tools"

const step = (s: { label?: string; state?: string }) => s.label ?? s.state ?? "the next step"

export const RELOAD_CUT_SCRIPT =
  "a reload cut a script off mid-run — check the working tree, then Continue to run it again"

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

export const lostLine = (scope: string) => `${scope}: subagent lost`

// What a push to a phone says when gtd stops: the step, and where to act on it.
export function pushText(stop: Stop, repo: string, url?: string) {
  const at = `${repo}: ${headline(stop).replace(/^\S+ /, "")}`
  if (stop.kind !== "gate") return at
  return url ? `${at}. Open: ${url}` : at
}

const capitalised = (s: string) => s[0]!.toUpperCase() + s.slice(1)

export const jobHeadline = (job: JobName, outcome: Shipped) =>
  `${outcome.ok ? "✔" : "✘"} ${capitalised(JOB_NAME[job])} ${outcome.ok ? "finished" : "failed"}`

export const jobPushText = (job: JobName, outcome: Shipped, repo: string) =>
  `${repo}: ${JOB_NAME[job]} ${outcome.ok ? "finished" : "failed"}. ${outcome.text}`.trim()
