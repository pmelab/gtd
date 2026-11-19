import { ChevronDown, ChevronRight, CircleCheck, LoaderCircle } from "lucide-react"
import { Button } from "../Button.js"
import { cn } from "../cn.js"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.js"
import { NoteLine } from "./NoteLine.js"
import { PressButton, Refused } from "./Press.js"
import { StatusBadge } from "./Status.js"
import { detailText, nowView, worktreeName, type Entry, type ProjectView } from "./view.js"

/** "Portal / plan": the project muted, the worktree in weight. */
export const EntryTitle = ({ entry }: { readonly entry: Entry }) => (
  <>
    <span className="text-muted-foreground">{entry.project.name}</span>
    <span className="px-1 text-muted-foreground">/</span>
    <span className="font-semibold text-foreground">{worktreeName(entry.worktree)}</span>
  </>
)

const Card = ({
  entry,
  selected,
  onOpen,
}: {
  readonly entry: Entry
  readonly selected: boolean
  readonly onOpen: () => void
}) => {
  const { worktree } = entry
  const reason = detailText(worktree)
  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-[0_1px_2px_rgb(21_26_29/0.05)]",
        selected ? "border-input" : "border-border",
        worktree.unavailable !== undefined && "opacity-60",
      )}
      aria-current={selected || undefined}
      data-testid="now-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <h2 className="min-w-0 text-base leading-snug">
          <EntryTitle entry={entry} />
        </h2>
        <StatusBadge worktree={worktree} />
      </div>
      {reason !== "" && <p className="max-w-prose text-sm text-foreground">{reason}</p>}
      <NoteLine worktree={worktree} />
      <Refused worktree={worktree} />
      <div className="flex items-start gap-2 lg:flex-row-reverse lg:justify-start">
        <PressButton worktree={worktree} className="w-full lg:min-w-32" />
        <Button variant="ghost" onClick={onOpen}>
          Open
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </article>
  )
}

const Working = ({
  working,
  onOpen,
}: {
  readonly working: readonly Entry[]
  readonly onOpen: (entry: Entry) => void
}) => (
  <Collapsible className="group rounded-lg border border-border bg-card" data-testid="now-working">
    <CollapsibleTrigger className="flex min-h-11 w-full items-center gap-2 rounded-lg px-4 text-sm text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <LoaderCircle aria-hidden="true" className="size-4" />
      <span className="tabular-nums">{working.length} working</span>
      <ChevronDown
        aria-hidden="true"
        className="ml-auto size-4 transition-transform group-data-[state=open]:rotate-180"
      />
    </CollapsibleTrigger>
    <CollapsibleContent>
      <ul className="border-t border-border">
        {working.map((entry) => (
          <li key={entry.worktree.path} className="border-b border-border last:border-b-0">
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              onClick={() => {
                onOpen(entry)
              }}
            >
              <span className="min-w-0">
                <EntryTitle entry={entry} />
              </span>
              <span className="shrink-0 text-muted-foreground">{entry.worktree.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </CollapsibleContent>
  </Collapsible>
)

/**
 * The Now view: only gates and errors, across all projects, each with its one
 * action. Working worktrees fold into one row.
 */
export const Now = ({
  projects,
  selected,
  onOpen,
}: {
  readonly projects: readonly ProjectView[]
  /** The path of the worktree whose detail is open beside the list. */
  readonly selected?: string | undefined
  readonly onOpen: (entry: Entry) => void
}) => {
  const { attention, working } = nowView(projects)
  return (
    <div className="flex flex-col gap-3">
      {attention.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <CircleCheck aria-hidden="true" className="size-6" />
          <p data-testid="now-empty">Nothing needs you.</p>
        </div>
      )}
      {attention.map((entry) => (
        <Card
          key={entry.worktree.path}
          entry={entry}
          selected={entry.worktree.path === selected}
          onOpen={() => {
            onOpen(entry)
          }}
        />
      ))}
      {working.length > 0 && <Working working={working} onOpen={onOpen} />}
    </div>
  )
}
