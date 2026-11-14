// PROTOTYPE — throwaway (pmelab/gtd#593).
// Variant C, "Master–detail": a dense one-line-per-worktree list (status as a colour bar, not
// emoji) beside a detail pane whose main content IS the gate page, with Terminal and Actions
// as tabs. On a phone the list is the page and the detail replaces it (back button).
import { useState } from "react"
import { Button } from "../Button.js"
import { cn } from "../cn.js"
import { ActionPicker, GatePreview, NewWorktree, ServiceChips } from "./bits.js"
import { allRows, inbox, projects, statusBar, statusColor, statusText, type Row } from "./data.js"

export const name = "Master–detail (list + gate-first detail pane)"

type Pane = "gate" | "terminal" | "actions"

const Detail = ({ row, back }: { row: Row; back: () => void }) => {
  const [pane, setPane] = useState<Pane>(row.status === "gate" ? "gate" : row.status === "idle" ? "actions" : "terminal")
  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-2 border-b border-divider p-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="md:hidden" onClick={back} aria-label="Back">
            ‹
          </Button>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{row.worktree}</span>
            <span className="truncate text-small text-muted">
              {row.project} · {row.branch} · {row.age}
            </span>
          </div>
          {row.status === "gate" && <Button variant="primary">Proceed</Button>}
          {row.status === "error" && <Button variant="primary">Retry</Button>}
        </div>
        <span className={cn("text-small", statusColor[row.status])}>
          {statusText[row.status]} — {row.label}
        </span>
        <ServiceChips services={row.services} />
        <div className="flex gap-1">
          {(["gate", "terminal", "actions"] as Pane[]).map((p) => (
            <button
              key={p}
              disabled={p === "gate" && row.status !== "gate"}
              onClick={() => setPane(p)}
              className={cn(
                "min-h-9 rounded px-3 text-small capitalize disabled:text-disabled",
                pane === p ? "bg-surface text-text" : "text-muted",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {pane === "gate" && <GatePreview row={row} />}
        {pane === "terminal" && (
          <pre className="whitespace-pre-wrap rounded bg-surface p-3 font-mono text-small text-muted">
            {`$ <driver> (OSC 7501: ${row.terminal})\n…\n${row.note ?? ""}`}
          </pre>
        )}
        {pane === "actions" && <ActionPicker row={row} />}
      </div>
    </div>
  )
}

export const VariantC = () => {
  const [sel, setSel] = useState<Row | undefined>(allRows.find((r) => r.status === "gate"))
  const [view, setView] = useState<"worktrees" | "inbox">("worktrees")
  const [mobileDetail, setMobileDetail] = useState(false)
  return (
    <div className="flex h-dvh bg-page text-text">
      <aside
        className={cn(
          "flex w-full flex-col border-r border-divider md:w-[360px] md:shrink-0",
          mobileDetail && "hidden md:flex",
        )}
      >
        <div className="flex gap-1 border-b border-divider p-2">
          {(["worktrees", "inbox"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn("min-h-9 flex-1 rounded text-small capitalize", view === v ? "bg-surface" : "text-muted")}
            >
              {v}
              {v === "inbox" ? ` · ${inbox.length}` : ""}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {view === "worktrees" &&
            projects.map((p) => (
              <section key={p.id}>
                <div className="sticky top-0 flex items-center justify-between bg-page px-3 pt-3 pb-1 text-small text-muted">
                  <span>
                    {p.name}
                    {p.paused ? " · paused" : ""}
                  </span>
                  <NewWorktree project={p.name} compact />
                </div>
                {p.rows.map((r) => (
                  <button
                    key={r.worktree}
                    onClick={() => {
                      setSel(r)
                      setMobileDetail(true)
                    }}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 pr-3 text-left",
                      sel?.worktree === r.worktree && "bg-surface",
                    )}
                  >
                    <span className={cn("h-11 w-1 shrink-0", statusBar[r.status])} />
                    <span className="min-w-0 flex-1 truncate text-small">{r.worktree}</span>
                    <span className={cn("shrink-0 text-small", statusColor[r.status])}>{statusText[r.status]}</span>
                    <span className="w-8 shrink-0 text-right text-small text-muted">{r.age}</span>
                  </button>
                ))}
              </section>
            ))}
          {view === "inbox" && (
            <table className="w-full text-small">
              <tbody>
                {inbox.map((i) => (
                  <tr key={i.key} className="border-b border-divider">
                    <td className="py-2 pl-3 text-muted">{i.key}</td>
                    <td className="py-2">{i.title}</td>
                    <td className="py-2 pr-3 text-right text-muted">{i.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
      <main className={cn("min-w-0 flex-1", !mobileDetail && "hidden md:block")}>
        {sel ? (
          <Detail key={sel.worktree} row={sel} back={() => setMobileDetail(false)} />
        ) : (
          <p className="p-8 text-muted">Pick a worktree.</p>
        )}
      </main>
    </div>
  )
}
