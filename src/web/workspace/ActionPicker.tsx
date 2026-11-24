import { CircleCheck, CircleX, LoaderCircle, Play } from "lucide-react"
import { useId, useState } from "react"
import { Button } from "../Button.js"
import { Notice } from "../Notice.js"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card.js"
import { Checkbox } from "../ui/checkbox.js"
import { Input } from "../ui/input.js"
import { Label } from "../ui/label.js"
import { NativeSelect } from "../ui/native-select.js"
import { Skeleton } from "../ui/skeleton.js"
import { workspaceTrpc } from "./api.js"
import { pressFor, type Action, type ActionField, type WorktreeView } from "./view.js"

type Values = Record<string, string | true>

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
  const id = useId()
  const help = field.help === undefined ? undefined : `${id}-help`
  if (field.type === "flag") {
    return (
      <div className="flex items-start gap-3">
        <Checkbox
          id={id}
          className="mt-0.5"
          checked={value === true}
          onCheckedChange={(checked) => {
            onChange(checked === true ? true : undefined)
          }}
        />
        <Label htmlFor={id} className="font-medium">
          {field.name}
        </Label>
      </div>
    )
  }
  const text = typeof value === "string" ? value : ""
  const set = (next: string) => {
    onChange(next === "" ? undefined : next)
  }
  const common = { id, value: text, required: field.required, "aria-describedby": help }
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="gap-1 font-medium">
        {field.name}
        {field.required && (
          <span className="text-muted-foreground" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      {field.type === "select" ? (
        <NativeSelect
          {...common}
          onChange={(e) => {
            set(e.target.value)
          }}
        >
          <option value="">Choose…</option>
          {(field.choices ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </NativeSelect>
      ) : (
        <Input
          {...common}
          onChange={(e) => {
            set(e.target.value)
          }}
        />
      )}
      {help !== undefined && (
        <p id={help} className="text-sm text-muted-foreground">
          {field.help}
        </p>
      )}
    </div>
  )
}

// fallow-ignore-next-line complexity
const Form = ({
  actions,
  onRun,
  pending,
  primary,
}: {
  readonly actions: readonly Action[]
  readonly onRun: (id: string, values: Values) => void
  readonly pending: boolean
  /** Secondary while the worktree's own press (Proceed) is the yellow one. */
  readonly primary: boolean
}) => {
  const [id, setId] = useState(actions[0]?.id ?? "")
  const [values, setValues] = useState<Values>({})
  const picker = useId()
  const action = actions.find((a) => a.id === id) ?? actions[0]
  if (action === undefined) {
    return <p className="text-sm text-muted-foreground">No actions for this status.</p>
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onRun(action.id, values)
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={picker} className="font-medium">
          Action
        </Label>
        <NativeSelect
          id={picker}
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
        </NativeSelect>
      </div>
      {action.fields.length > 0 && (
        <fieldset className="flex flex-col gap-4 border-t border-border pt-4">
          <legend className="sr-only">{action.label}</legend>
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
        </fieldset>
      )}
      <Button
        type="submit"
        variant={primary ? "primary" : "secondary"}
        className="self-start"
        disabled={pending}
      >
        <Play aria-hidden="true" />
        Run
      </Button>
    </form>
  )
}

const LastRun = ({ worktree }: { readonly worktree: WorktreeView }) => {
  if (worktree.action === undefined) return null
  const { label, exit, message } = worktree.action
  const state = exit === null ? "running" : `exited ${exit}`
  const Icon = exit === null ? LoaderCircle : exit === 0 ? CircleCheck : CircleX
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground">
      <Icon
        aria-hidden="true"
        className={
          exit === null
            ? "mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none"
            : `mt-0.5 size-4 shrink-0 ${exit === 0 ? "text-success" : "text-destructive"}`
        }
      />
      <span data-testid="last-action">
        {[`${label}: ${state}`, message].filter(Boolean).join(" — ")}
      </span>
    </p>
  )
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
  return (
    <Card data-testid="actions-tab">
      <CardHeader>
        <CardTitle>Run an action</CardTitle>
        <CardDescription>Each action runs in a terminal pane of its own.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {offered.isLoading && (
          <div className="flex flex-col gap-2" aria-busy="true">
            <span className="sr-only" role="status">
              Loading actions…
            </span>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-11 w-full lg:h-9" />
          </div>
        )}
        {offered.error !== null && (
          <Notice tone="error" className="w-full">
            <p>Could not read the actions: {offered.error.message}</p>
          </Notice>
        )}
        {offered.data !== undefined && (
          <Form
            key={offered.data.status}
            actions={offered.data.actions}
            pending={run.isPending}
            primary={pressFor(worktree) !== "proceed"}
            onRun={(action, values) => {
              run.mutate({ ...input, action, values })
            }}
          />
        )}
        {run.error !== null && (
          <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
            <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span data-testid="action-error">{run.error.message}</span>
          </p>
        )}
        <LastRun worktree={worktree} />
      </CardContent>
    </Card>
  )
}
