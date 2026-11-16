import { useState } from "react"
import { Button } from "../Button.js"
import { workspaceTrpc } from "./api.js"
import type { Action, ActionField, WorktreeView } from "./view.js"

type Values = Record<string, string | true>

const INPUT =
  "min-h-11 rounded border border-border bg-surface px-2 text-body text-text placeholder:text-disabled"

// fallow-ignore-next-line complexity
const Field = ({
  field,
  value,
  onChange,
}: {
  readonly field: ActionField
  readonly value: string | true | undefined
  readonly onChange: (value: string | true | undefined) => void
}) => {
  if (field.type === "flag") {
    return (
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => {
            onChange(e.target.checked ? true : undefined)
          }}
        />
        {field.name}
      </label>
    )
  }
  const text = typeof value === "string" ? value : ""
  const set = (next: string) => {
    onChange(next === "" ? undefined : next)
  }
  return (
    <label className="flex flex-col gap-1">
      <span className="text-small text-muted">
        {field.name}
        {field.required ? " *" : ""}
      </span>
      {field.type === "select" ? (
        <select
          className={INPUT}
          value={text}
          required={field.required}
          onChange={(e) => {
            set(e.target.value)
          }}
        >
          <option value="" />
          {(field.choices ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : (
        <input
          className={INPUT}
          value={text}
          required={field.required}
          onChange={(e) => {
            set(e.target.value)
          }}
        />
      )}
      {field.help !== undefined && <span className="text-small text-muted">{field.help}</span>}
    </label>
  )
}

// fallow-ignore-next-line complexity
const Form = ({
  actions,
  onRun,
  pending,
}: {
  readonly actions: readonly Action[]
  readonly onRun: (id: string, values: Values) => void
  readonly pending: boolean
}) => {
  const [id, setId] = useState(actions[0]?.id ?? "")
  const [values, setValues] = useState<Values>({})
  const action = actions.find((a) => a.id === id) ?? actions[0]
  if (action === undefined) {
    return <p className="text-small text-muted">No actions for this status.</p>
  }
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        onRun(action.id, values)
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-small text-muted">Action</span>
        <select
          className={INPUT}
          value={action.id}
          onChange={(e) => {
            setId(e.target.value)
            setValues({})
          }}
        >
          {actions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} ({a.id})
            </option>
          ))}
        </select>
      </label>
      {action.fields.map((field) => (
        <Field
          key={`${action.id}/${field.name}`}
          field={field}
          value={values[field.name]}
          onChange={(value) => {
            const { [field.name]: _, ...rest } = values
            setValues(value === undefined ? rest : { ...rest, [field.name]: value })
          }}
        />
      ))}
      <Button type="submit" variant="primary" disabled={pending}>
        Run
      </Button>
    </form>
  )
}

const lastRun = (w: WorktreeView): string | undefined => {
  if (w.action === undefined) return undefined
  const { label, exit, message } = w.action
  const state = exit === null ? "running" : `exited ${exit}`
  return [`${label}: ${state}`, message].filter(Boolean).join(" — ")
}

/** The actions offered in the worktree's status now, with their fields; each runs in a pane of its own. */
// fallow-ignore-next-line complexity
export const ActionPicker = ({
  project,
  worktree,
}: {
  readonly project: string
  readonly worktree: WorktreeView
}) => {
  const input = { project, worktree: worktree.path }
  const offered = workspaceTrpc.actions.useQuery(input)
  const utils = workspaceTrpc.useUtils()
  const run = workspaceTrpc.runAction.useMutation({
    onSettled: () => utils.projects.invalidate(),
  })
  const last = lastRun(worktree)
  return (
    <div className="flex flex-col gap-3 p-4" data-testid="actions-tab">
      {offered.isLoading && <p className="text-muted">Loading…</p>}
      {offered.error !== null && <p className="text-danger">{offered.error.message}</p>}
      {offered.data !== undefined && (
        <Form
          key={offered.data.status}
          actions={offered.data.actions}
          pending={run.isPending}
          onRun={(action, values) => {
            run.mutate({ ...input, action, values })
          }}
        />
      )}
      {run.error !== null && (
        <p className="text-small text-danger" data-testid="action-error">
          {run.error.message}
        </p>
      )}
      {last !== undefined && (
        <p className="text-small text-muted" data-testid="last-action">
          {last}
        </p>
      )}
    </div>
  )
}
