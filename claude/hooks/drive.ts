import type { Stop } from "../types"

// The subset of `gtd next --json` this driver reads. Absent optional fields
// are simply missing; booleans may arrive as strings.
export type Beat = {
  kind: string
  idle?: boolean | string
  state?: string
  label?: string
  file?: string
  content?: string
  log?: string
  memory?: string
  model?: string
  system?: string
  validate?: string
  judge?: unknown
  session?: { id?: string; resume?: boolean | string }
}

export type Landing = {
  script: string
  settled?: boolean | string
  idle?: boolean | string
  subject?: string
}

export type Turn = {
  memory: string
  resume: boolean
  prompt: string
  label?: string
  model?: string
  system?: string
}

export type TurnEnd = { ok: true } | { ok: false; why: string }

export type Io = {
  next(): Promise<Beat>
  plain(): Promise<string>
  land(verdict?: string): Promise<Landing>
  sh(script: string, log?: string): Promise<number>
  check(script: string): Promise<{ ok: boolean; out: string }>
  judge(): Promise<string | undefined>
  turn(t: Turn): Promise<TurnEnd>
  resume(memory: string, text: string): Promise<TurnEnd>
  progress(beat: number, b: Beat): void
  stopped(): boolean
}

const MAX_FIXES = 3

export const isTrue = (v: unknown) => v === true || v === "true"

// The reference sh driver from docs/driver.md, beat for beat. gtd decides;
// this only executes what `gtd next` and `gtd land` print.
export async function drive(io: Io): Promise<Stop> {
  // A judge gate answered on the previous beat that rests on the same state
  // again moved nothing: hand it to the human rather than pay for it twice.
  let judged: string | undefined
  for (let beat = 1; ; beat++) {
    if (io.stopped()) return { kind: "stopped", text: "stopped on request" }
    const b = await io.next()
    const at = { state: b.state, label: b.label }
    io.progress(beat, b)

    // The opening beat lands even at idle: a re-run there is the human's
    // decision, and an `acceptClean` first step must get to fire.
    if (beat > 1 && isTrue(b.idle)) {
      return { kind: "done", text: await io.plain(), ...at }
    }

    let verdict: string | undefined
    switch (b.kind) {
      case "stalled":
        return { kind: "stalled", text: b.content ?? "", ...at }
      case "message":
        if (b.judge && judged !== b.state) verdict = await io.judge()
        // Any later beat is a gate this run produced and the human has not
        // read yet.
        if (!verdict && beat > 1) {
          return {
            kind: "gate",
            text: b.content ?? "",
            ...at,
            ...(b.judge ? { isJudge: true } : {}),
          }
        }
        break
      case "capture":
        break
      case "script":
        await io.sh(b.content ?? "", b.log)
        break
      case "prompt": {
        const memory = b.memory ?? b.session?.id ?? b.state ?? "root"
        const t = await io.turn({
          memory,
          resume: isTrue(b.session?.resume),
          prompt: b.content ?? "",
          label: b.label,
          model: b.model || undefined,
          system: b.system || undefined,
        })
        if (!t.ok) return { kind: "error", text: t.why, ...at }
        for (let fixes = 0; b.validate; fixes++) {
          const v = await io.check(b.validate)
          if (v.ok) break
          if (fixes >= MAX_FIXES) {
            return {
              kind: "error",
              text: `validation still failing after ${fixes} fixes\n${v.out}`,
              ...at,
            }
          }
          const f = await io.resume(memory, v.out)
          if (!f.ok) return { kind: "error", text: f.why, ...at }
        }
        break
      }
      default:
        return { kind: "error", text: `unknown beat kind '${b.kind}'`, ...at }
    }
    judged = verdict ? b.state : undefined

    const l = await io.land(verdict)
    const code = await io.sh(l.script, b.log)
    if (code !== 0) {
      return { kind: "error", text: `landing script exited ${code}`, ...at }
    }
    if (isTrue(l.settled)) {
      const text = isTrue(l.idle) ? await io.plain() : l.subject || "settled"
      return { kind: "done", text, ...at }
    }
  }
}
