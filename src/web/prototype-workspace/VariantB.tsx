// PROTOTYPE — throwaway (pmelab/gtd#593).
// Variant B, "Now / Projects / Inbox": phone-first. The default tab is an attention feed — only
// what needs a person, across all projects, as big cards with one obvious button. Everything
// else sits behind a bottom tab bar; a row opens as a bottom sheet with its gate and actions.
import { useState } from "react"
import { Button } from "../Button.js"
import { cn } from "../cn.js"
import { ActionPicker, GatePreview, NewWorktree, ServiceChips } from "./bits.js"
import { allRows, inbox, limits, marker, projects, statusColor, statusText, type InboxState, type Row } from "./data.js"

export const name = "Now / Projects / Inbox (attention feed + tabs)"

type Tab = "now" | "projects" | "inbox"

const Sheet = ({ row, onClose }: { row: Row; onClose: () => void }) => (
  <div className="fixed inset-0 z-10 flex flex-col justify-end bg-black/60" onClick={onClose}>
    <div
      className="mx-auto flex max-h-[90dvh] w-full max-w-[430px] flex-col gap-4 overflow-y-auto rounded-t-xl bg-surface p-4"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.worktree}</span>
          <span className="text-small text-muted">
            {row.project} · {row.branch}
          </span>
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="Close">
          ×
        </Button>
      </div>
      <span className={cn("text-small", statusColor[row.status])}>
        {marker[row.status]} {row.label}
      </span>
      <span className="text-small text-muted">{row.terminal}</span>
      <ServiceChips services={row.services} />
      {row.status === "gate" && <GatePreview row={row} />}
      <ActionPicker row={row} />
    </div>
  </div>
)

const Now = ({ open }: { open: (r: Row) => void }) => {
  const attention = allRows.filter((r) => r.status === "gate" || r.status === "error")
  const working = allRows.filter((r) => r.status === "working")
  return (
    <div className="flex flex-col gap-3">
      {attention.length === 0 && <p className="py-12 text-center text-muted">Nothing needs you.</p>}
      {attention.map((r) => (
        <article
          key={r.worktree}
          className={cn("flex flex-col gap-3 rounded-lg border bg-surface p-4", r.status === "gate" ? "border-warning" : "border-danger")}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn("text-small font-medium uppercase tracking-wide", statusColor[r.status])}>
              {statusText[r.status]}
            </span>
            <span className="text-small text-muted">{r.age} ago</span>
          </div>
          <span className="text-large">{r.label}</span>
          <span className="truncate text-small text-muted">
            {r.project} / {r.worktree}
          </span>
          {r.note && <p className="text-small text-muted">{r.note}</p>}
          <div className="flex gap-2">
            {r.status === "gate" ? (
              <>
                <Button variant="primary" className="flex-1" onClick={() => open(r)}>
                  Open gate
                </Button>
                <Button>Proceed</Button>
              </>
            ) : (
              <>
                <Button variant="primary" className="flex-1">
                  Retry
                </Button>
                <Button onClick={() => open(r)}>More…</Button>
              </>
            )}
          </div>
        </article>
      ))}
      {working.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-divider p-3">
          <span className="text-small text-muted">{working.length} working</span>
          {working.map((r) => (
            <button key={r.worktree} className="flex justify-between gap-2 py-1 text-left text-small" onClick={() => open(r)}>
              <span className="truncate">{r.worktree}</span>
              <span className="shrink-0 text-link">{r.label.split(":")[0]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const Projects = ({ open }: { open: (r: Row) => void }) => (
  <div className="flex flex-col gap-5">
    {projects.map((p) => (
      <section key={p.id} className="flex flex-col">
        <div className="flex items-center justify-between pb-1">
          <h2 className="font-medium">{p.name}</h2>
          <ServiceChips services={p.services} />
        </div>
        {p.rows.map((r) => (
          <button
            key={r.worktree}
            onClick={() => open(r)}
            className="flex min-h-11 items-center gap-3 border-b border-divider text-left"
          >
            <span>{marker[r.status]}</span>
            <span className="min-w-0 flex-1 truncate">{r.worktree}</span>
            <span className="shrink-0 text-small text-muted">{r.age}</span>
          </button>
        ))}
        <NewWorktree project={p.name} compact />
      </section>
    ))}
  </div>
)

const groups: Array<[string, InboxState[]]> = [
  ["Waiting for you", ["proposed"]],
  ["Up next", ["queued", "blocked"]],
  ["Running", ["starting", "started"]],
  ["Done / failed", ["shipped", "failed"]],
]

const Inbox = () => (
  <div className="flex flex-col gap-5">
    <div className="flex items-center justify-between rounded-lg border border-divider p-3 text-small">
      <span>
        {limits.drives} of {limits.maxDrives} drives · paused: {limits.paused.join(", ")}
      </span>
      <Button variant="ghost" className="min-h-9 text-small">
        Pause all
      </Button>
    </div>
    {groups.map(([title, states]) => {
      const items = inbox.filter((i) => states.includes(i.state))
      if (items.length === 0) return null
      return (
        <section key={title} className="flex flex-col gap-2">
          <h2 className="text-small text-muted">{title}</h2>
          {items.map((i) => (
            <div key={i.key} className="flex flex-col gap-1 rounded-lg bg-surface p-3">
              <span>{i.title}</span>
              <span className="text-small text-muted">
                {i.key} · {i.source} · {i.workflow} · P{i.priority}
                {i.blockedBy ? ` · blocked by ${i.blockedBy}` : ""}
                {i.worktree ? ` · ${i.worktree}` : ""}
              </span>
              {i.state === "proposed" && (
                <div className="flex gap-2 pt-1">
                  <Button variant="primary" className="min-h-9 text-small">
                    Start
                  </Button>
                  <Button variant="ghost" className="min-h-9 text-small">
                    Dismiss
                  </Button>
                </div>
              )}
            </div>
          ))}
        </section>
      )
    })}
  </div>
)

export const VariantB = () => {
  const [tab, setTab] = useState<Tab>("now")
  const [row, setRow] = useState<Row>()
  const attention = allRows.filter((r) => r.status === "gate" || r.status === "error").length
  return (
    <div className="mx-auto flex min-h-dvh max-w-[430px] flex-col bg-page text-text">
      <main className="flex-1 p-4 pb-24">
        {tab === "now" && <Now open={setRow} />}
        {tab === "projects" && <Projects open={setRow} />}
        {tab === "inbox" && <Inbox />}
      </main>
      <nav className="fixed bottom-0 left-1/2 flex w-full max-w-[430px] -translate-x-1/2 border-t border-divider bg-surface">
        {(
          [
            ["now", `Now${attention ? ` (${attention})` : ""}`],
            ["projects", "Projects"],
            ["inbox", `Inbox (${inbox.filter((i) => i.state === "proposed" || i.state === "queued").length})`],
          ] as Array<[Tab, string]>
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn("min-h-14 flex-1 text-small", tab === t ? "text-link" : "text-muted")}
          >
            {label}
          </button>
        ))}
      </nav>
      {row && <Sheet row={row} onClose={() => setRow(undefined)} />}
    </div>
  )
}
