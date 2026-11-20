import type { Retrospective } from "../../supervisor/index.js"

const step = (
  n: number,
  actor: string,
  from: string,
  to: string,
  extra: Partial<Retrospective["processes"][number]["steps"][number]> = {},
) => ({
  hash: `${n}`.padStart(40, "0"),
  actor,
  from,
  to,
  time: new Date(Date.UTC(2026, 0, 1, 10, n)).toISOString(),
  gap: n === 0 ? undefined : 60,
  costs: [],
  verdicts: [],
  approvedBy: undefined,
  exit: undefined,
  ticked: [],
  written: [],
  notes: [],
  todo: undefined,
  ...extra,
})

/** A full run: all four actors, a judge sending the work back, a failed check. */
export const fullRun: Retrospective = {
  total: 1.25,
  byModel: { opus: 1, sonnet: 0.25 },
  processes: [
    {
      entry: "e2",
      finished: false,
      total: 1.25,
      byModel: { opus: 1, sonnet: 0.25 },
      steps: [
        step(0, "human", "design.start", "design.triage", {
          todo: "Add a retrospective tab",
        }),
        step(1, "agent", "design.triage", "design.criteria", {
          costs: [{ cost: 1, model: "opus" }],
        }),
        step(2, "check", "design.criteria", "design.lint", { exit: 1 }),
        step(3, "judge", "design.lint", "design.triage", {
          verdicts: [{ id: "criteria", answer: "no", p: 0.82, sentBack: true }],
        }),
        step(4, "agent", "design.triage", "design.gate", {
          costs: [{ cost: 0.25, model: "sonnet" }],
        }),
        step(5, "human", "design.gate", "build.naive", {
          ticked: ["Go"],
          written: ["Keep it small"],
          notes: ["Mind the phone"],
          approvedBy: "Ada",
        }),
        step(6, "check", "build.naive", "build.test", { exit: 0 }),
        step(7, "check", "build.test", "build.done"),
      ],
    },
    {
      entry: "e1",
      finished: true,
      total: 0,
      byModel: {},
      steps: [step(0, "human", "a.one", "a.two", { todo: "An older job" })],
    },
  ],
}
