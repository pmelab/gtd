// PROTOTYPE — throwaway (pmelab/gtd#593). Small pieces the variants share; no shared layout.
import { useState } from "react"
import { Button } from "../Button.js"
import { cn } from "../cn.js"
import { actionsFor, type Row, type Service } from "./data.js"

export const ServiceChips = ({ services, className }: { services: readonly Service[]; className?: string }) =>
  services.length === 0 ? null : (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {services.map((s) => (
        <a
          key={s.name}
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-divider px-2 py-0.5 text-small text-link"
        >
          {s.name} <span className={s.running ? "text-[#1fd8a4]" : "text-muted"}>{s.running ? "●" : "○"}</span>
        </a>
      ))}
    </div>
  )

/** The one action contract: pick an action valid for the row's status, fill its fields, run it in the terminal. */
export const ActionPicker = ({ row, onDone }: { row: Row; onDone?: () => void }) => {
  const list = actionsFor(row.status)
  const [id, setId] = useState(list[0]?.id)
  const [ran, setRan] = useState<string>()
  const action = list.find((a) => a.id === id)
  if (list.length === 0) return <p className="text-small text-muted">No actions for this status.</p>
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        setRan(`typed into ${row.worktree}'s terminal: run ${id} …`)
        onDone?.()
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-small text-muted">Action</span>
        <select
          className="min-h-11 rounded border border-border bg-surface px-2 text-body text-text"
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          {list.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} ({a.id})
            </option>
          ))}
        </select>
      </label>
      {action?.fields.map((f) =>
        f.kind === "flag" ? (
          <label key={f.name} className="flex min-h-11 items-center gap-2 text-body">
            <input type="checkbox" className="size-5" /> --{f.name}
          </label>
        ) : f.kind === "select" ? (
          <label key={f.name} className="flex flex-col gap-1">
            <span className="text-small text-muted">{f.name}</span>
            <select className="min-h-11 rounded border border-border bg-surface px-2 text-body text-text">
              {f.choices?.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        ) : (
          <label key={f.name} className="flex flex-col gap-1">
            <span className="text-small text-muted">
              {f.name}
              {f.required ? " *" : ""}
            </span>
            <input
              required={f.required}
              placeholder={f.placeholder}
              className="min-h-11 rounded border border-border bg-surface px-2 text-body text-text placeholder:text-disabled"
            />
            {f.help && <span className="text-small text-muted">{f.help}</span>}
          </label>
        ),
      )}
      <Button type="submit" variant="primary">
        Run
      </Button>
      {ran && <p className="text-small text-muted">{ran}</p>}
    </form>
  )
}

export const NewWorktree = ({ project, compact = false }: { project: string; compact?: boolean }) => {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const bad = name !== "" && (/\s|\.\.|^-/.test(name) || name.endsWith("/"))
  if (!open)
    return (
      <Button variant="ghost" className={cn("text-muted", compact && "min-h-9 px-2 text-small")} onClick={() => setOpen(true)}>
        + New worktree{compact ? "" : ` in ${project}`}
      </Button>
    )
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        setOpen(false)
        setName("")
      }}
    >
      <div className="flex gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          placeholder="feat/branch-name"
          className="min-h-11 flex-1 rounded border border-border bg-surface px-2 text-body text-text placeholder:text-disabled"
        />
        <Button type="submit" variant="primary" disabled={name === "" || bad}>
          Create
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} aria-label="Cancel">
          ×
        </Button>
      </div>
      {bad && <span className="text-small text-danger">Not a valid branch name.</span>}
    </form>
  )
}

/** Stand-in for the embedded gate route `/<project>/<worktree>/gate` (today's gtd ui document screen). */
export const GatePreview = ({ row, className }: { row: Row; className?: string }) => (
  <div className={cn("flex flex-col overflow-hidden rounded border border-divider bg-page", className)}>
    <div className="flex items-center justify-between border-b border-divider px-3 py-2 text-small text-muted">
      <span>
        /{row.project}/{row.worktree}/gate
      </span>
      <a className="text-link" href="#">
        open in tab ↗
      </a>
    </div>
    <div className="flex flex-col gap-3 p-4 text-body">
      <h1 className="text-large text-[#baa7ff]">Plan</h1>
      <p className="text-muted">The API has no limit today.</p>
      <h2 className="text-[#4ccce6]">🔘 Where is the counter stored?</h2>
      <label className="flex items-center gap-2">
        <input type="radio" name="g" className="size-5" /> Redis
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" name="g" className="size-5" /> Memory
      </label>
      <p className="text-small text-muted">(the real gtd ui document screen renders here)</p>
    </div>
  </div>
)
