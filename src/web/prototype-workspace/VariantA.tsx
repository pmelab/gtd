// PROTOTYPE — throwaway (pmelab/gtd#593).
// Variant A, "Sections": today's bench.internal structure in gtd's design. One long page,
// one section per project, every row's actions inline; the inbox is the last section.
import { useState } from "react"
import { Button } from "../Button.js"
import { cn } from "../cn.js"
import { ActionPicker, GatePreview, NewWorktree, ServiceChips } from "./bits.js"
import { inbox, limits, marker, projects, statusColor, type Row, type Status } from "./data.js"

export const name = "Sections (bench.internal in gtd's look)"

const order: Record<Status, number> = { gate: 0, error: 1, working: 2, idle: 3 }

const RowView = ({ row }: { row: Row }) => {
  const [open, setOpen] = useState<"start" | "gate" | "actions">()
  return (
    <li className="flex flex-col gap-2 border-b border-divider py-3">
      <div className="flex items-start gap-3">
        <span className="text-large leading-none" aria-label={row.status}>
          {marker[row.status]}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium">{row.worktree}</span>
            <span className="shrink-0 text-small text-muted">{row.age}</span>
          </div>
          <span className={cn("text-small", statusColor[row.status])}>{row.label}</span>
          <span className="truncate text-small text-muted">
            {row.branch} · {row.terminal}
          </span>
          {row.note && <p className="rounded bg-surface p-2 text-small text-muted">{row.note}</p>}
          <ServiceChips services={row.services} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-9">
        {row.status === "gate" && (
          <>
            <Button variant="primary">Proceed</Button>
            <Button onClick={() => setOpen(open === "gate" ? undefined : "gate")}>Open gate</Button>
          </>
        )}
        {row.status === "error" && <Button variant="primary">Retry</Button>}
        {row.status === "idle" && <Button onClick={() => setOpen(open === "start" ? undefined : "start")}>Start</Button>}
        {row.status !== "working" && (
          <Button variant="ghost" onClick={() => setOpen(open === "actions" ? undefined : "actions")}>
            Actions…
          </Button>
        )}
        {row.status === "idle" && <Button variant="danger">Remove</Button>}
        {row.status === "working" && <span className="text-small text-link">● running</span>}
      </div>
      {open === "gate" && <GatePreview row={row} className="ml-9" />}
      {(open === "start" || open === "actions") && (
        <div className="ml-9 rounded border border-divider p-3">
          <ActionPicker row={row} />
        </div>
      )}
    </li>
  )
}

export const VariantA = () => {
  const [showIdle, setShowIdle] = useState(false)
  return (
    <div className="mx-auto flex min-h-dvh max-w-[640px] flex-col gap-6 bg-page p-4 text-text">
      <header className="flex items-center justify-between">
        <h1 className="text-large font-medium">Workspace</h1>
        <label className="flex items-center gap-2 text-small text-muted">
          <input type="checkbox" checked={showIdle} onChange={(e) => setShowIdle(e.target.checked)} className="size-5" />
          show idle
        </label>
      </header>
      {projects.map((p) => {
        const rows = [...p.rows].sort((a, b) => order[a.status] - order[b.status])
        const hidden = rows.filter((r) => r.status === "idle").length
        return (
          <section key={p.id} className="flex flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
              <h2 className="font-medium">
                {p.name} {p.paused && <span className="text-small text-warning">· paused</span>}
              </h2>
              <ServiceChips services={p.services} />
            </div>
            <ul>{rows.filter((r) => showIdle || r.status !== "idle").map((r) => <RowView key={r.worktree} row={r} />)}</ul>
            <div className="flex items-center justify-between pt-1">
              <NewWorktree project={p.name} />
              {!showIdle && hidden > 0 && <span className="text-small text-muted">+{hidden} idle</span>}
            </div>
          </section>
        )
      })}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="font-medium">Inbox</h2>
          <span className="text-small text-muted">
            {limits.drives}/{limits.maxDrives} drives
          </span>
        </div>
        <ul className="flex flex-col">
          {inbox.map((i) => (
            <li key={i.key} className="flex items-baseline justify-between gap-2 border-b border-divider py-2 text-small">
              <span className="min-w-0 truncate">
                <span className="text-muted">{i.key}</span> {i.title}
              </span>
              <span className="shrink-0 text-muted">
                {i.workflow} · {i.state}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
