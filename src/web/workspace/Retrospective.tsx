import { Bot, Scale, Terminal, User, type LucideIcon } from "lucide-react"
import { Skeleton } from "../ui/skeleton.js"
import { workspaceTrpc } from "./api.js"
import type { WorktreeView } from "./view.js"
import type { inferRouterOutputs } from "@trpc/server"
import type { WorkspaceRouter } from "../../supervisor/index.js"

type History = inferRouterOutputs<WorkspaceRouter>["retrospective"]
type RetroProcess = History["processes"][number]
type RetroStep = RetroProcess["steps"][number]

const ACTORS: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  human: { label: "Human", icon: User, color: "text-actor-human" },
  agent: { label: "Agent", icon: Bot, color: "text-actor-agent" },
  judge: { label: "Judge", icon: Scale, color: "text-actor-judge" },
  check: { label: "Script", icon: Terminal, color: "text-actor-check" },
}

const dollars = (n: number): string => `$${n.toFixed(2)}`

const duration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

const split = (byModel: Readonly<Record<string, number>>): string =>
  Object.entries(byModel)
    .map(([model, cost]) => `${model} ${dollars(cost)}`)
    .join(" · ")

const groupSteps = (steps: readonly RetroStep[]): { name: string; steps: RetroStep[] }[] => {
  const groups: { name: string; steps: RetroStep[] }[] = []
  for (const step of steps) {
    const name = step.to.split(".")[0]!
    const last = groups[groups.length - 1]
    if (last?.name === name) last.steps.push(step)
    else groups.push({ name, steps: [step] })
  }
  return groups
}

const costOf = (step: RetroStep): number => step.costs.reduce((sum, c) => sum + c.cost, 0)

// fallow-ignore-next-line complexity
const StepRow = ({ step }: { readonly step: RetroStep }) => {
  const actor = ACTORS[step.actor] ?? ACTORS["human"]!
  const Icon = actor.icon
  return (
    <li
      className="flex min-w-0 flex-col gap-1 border-b border-border py-2"
      data-testid="retro-step"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`flex items-center gap-1 font-medium ${actor.color}`}>
          <Icon aria-hidden="true" className="size-4" />
          {actor.label}
        </span>
        <span className="min-w-0 break-words">
          {step.from !== undefined ? `${step.from} → ${step.to}` : step.to}
        </span>
      </div>
      <div className="text-small text-muted-foreground">
        <time dateTime={step.time}>{new Date(step.time).toLocaleString()}</time>
        {step.gap !== undefined && <span> · +{duration(step.gap)}</span>}
      </div>
      {step.todo !== undefined && (
        <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-2 text-small break-words whitespace-pre-wrap">
          {step.todo}
        </pre>
      )}
      {step.actor === "agent" && step.costs.length > 0 && (
        <div className="text-small">
          {dollars(costOf(step))} · {step.costs.map((c) => c.model ?? "unknown").join(", ")}
        </div>
      )}
      {step.actor === "check" && (
        <div className="text-small">
          {step.exit === undefined
            ? "Exit unknown"
            : step.exit === 0
              ? "Exit 0"
              : `Failed · exit ${step.exit}`}
        </div>
      )}
      {step.verdicts.map((v) => (
        <div key={v.id} className="text-small break-words">
          {v.id}: {String(v.answer)} ({Math.round(v.p * 100)}%) ·{" "}
          {v.sentBack ? "sent back" : "let through"}
        </div>
      ))}
      {step.actor === "human" && (
        <div className="flex flex-col gap-0.5 text-small break-words">
          {step.ticked.map((t) => (
            <span key={`t-${t}`}>Ticked: {t}</span>
          ))}
          {step.written.map((t) => (
            <span key={`w-${t}`}>Answered: {t}</span>
          ))}
          {step.notes.map((t) => (
            <span key={`n-${t}`}>Note: {t}</span>
          ))}
          <span className="font-medium">
            {step.approvedBy !== undefined ? `Approved by ${step.approvedBy}` : "Proceed"}
          </span>
        </div>
      )}
    </li>
  )
}

const Group = ({
  group,
  open,
}: {
  readonly group: { name: string; steps: readonly RetroStep[] }
  readonly open: boolean
}) => {
  const subtotal = group.steps.reduce((sum, s) => sum + costOf(s), 0)
  return (
    <details open={open} className="min-w-0" data-testid="retro-group">
      <summary className="min-h-11 cursor-pointer py-2 font-medium break-words">
        {group.name} · {group.steps.length} steps
        {subtotal > 0 ? ` · ${dollars(subtotal)}` : ""}
      </summary>
      <ol className="min-w-0">
        {group.steps.map((s) => (
          <StepRow key={s.hash} step={s} />
        ))}
      </ol>
    </details>
  )
}

const Process = ({ process, open }: { readonly process: RetroProcess; readonly open: boolean }) => {
  const groups = groupSteps(process.steps)
  return (
    <details
      open={open}
      className="min-w-0 rounded-lg border border-border bg-card p-3"
      data-testid="retro-process"
    >
      <summary className="min-h-11 cursor-pointer py-2 font-medium break-words">
        {new Date(process.steps[0]!.time).toLocaleString()}
        {process.finished ? " · finished" : ""} · {dollars(process.total)}
        {Object.keys(process.byModel).length > 0 ? ` (${split(process.byModel)})` : ""}
      </summary>
      {groups.map((g, i) => (
        <Group
          key={`${g.name}-${i}`}
          group={g}
          open={g.steps.length <= 10 || i === groups.length - 1}
        />
      ))}
    </details>
  )
}

export const RetrospectiveView = ({ history }: { readonly history: History }) => (
  <div className="flex min-w-0 flex-col gap-3" data-testid="retrospective-tab">
    <p className="text-small break-words" data-testid="retro-total">
      Worktree total {dollars(history.total)}
      {Object.keys(history.byModel).length > 0 ? ` (${split(history.byModel)})` : ""}
    </p>
    {history.processes.map((p, i) => (
      <Process key={p.entry} process={p} open={i === 0} />
    ))}
  </div>
)

/** The worktree's every process, reloaded when its HEAD moves. */
export const Retrospective = ({
  project,
  worktree,
}: {
  readonly project: string
  readonly worktree: WorktreeView
}) => {
  const query = workspaceTrpc.retrospective.useQuery({
    project,
    worktree: worktree.path,
    head: worktree.head,
  })
  if (query.data === undefined) return <Skeleton className="h-24 w-full" />
  return <RetrospectiveView history={query.data} />
}
