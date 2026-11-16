import { useState } from "react"
import { Button } from "../Button.js"
import { cn } from "../cn.js"
import { ActionPicker } from "./ActionPicker.js"
import { NoteLine } from "./NoteLine.js"
import { PressButton, Refused } from "./Press.js"
import { ServiceChips } from "./ServiceChips.js"
import { TabBar } from "./TabBar.js"
import { TerminalTab } from "./TerminalTab.js"
import { RemoveButton } from "./WorktreeChanges.js"
import { detailText, STATUS_COLOR, statusText, worktreeName, type Entry } from "./view.js"

type Tab = "gate" | "terminal" | "actions"

const TABS: readonly (readonly [Tab, string])[] = [
  ["gate", "Gate"],
  ["terminal", "Terminal"],
  ["actions", "Actions"],
]

/** The worktree's gate page, embedded from the URL the API names, with a way out to a full tab. */
const Gate = ({ gate }: { readonly gate: string }) => (
  <div className="flex min-h-0 flex-1 flex-col" data-testid="gate-tab">
    <div className="flex items-center justify-between gap-2 border-b border-divider px-4 py-2 text-small">
      <span className="min-w-0 text-muted">{gate}</span>
      <a
        className="shrink-0 text-link"
        href={gate}
        target="_blank"
        rel="noreferrer"
        data-testid="open-gate"
      >
        open in tab ↗
      </a>
    </div>
    <iframe className="min-h-0 w-full flex-1 border-0 bg-page" src={gate} title="Gate page" />
  </div>
)

/**
 * A worktree's detail: the gate page first, Terminal and Actions as tabs. On
 * a phone it covers the screen with its tab bar at the bottom; on a wide
 * screen it is a pane beside the list, tabs on top.
 */
export const Detail = ({
  entry,
  onClose,
}: {
  readonly entry: Entry
  readonly onClose: () => void
}) => {
  const [tab, setTab] = useState<Tab>("gate")
  const { project, worktree } = entry
  return (
    <section
      className="fixed inset-0 z-10 flex flex-col bg-page md:static md:z-auto md:min-h-dvh md:flex-1 md:border-l md:border-divider"
      aria-label={`${project.name} / ${worktreeName(worktree)}`}
      data-testid="detail"
    >
      <header className="flex flex-col gap-2 border-b border-divider p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <span className="font-medium">{worktreeName(worktree)}</span>
            <span className="text-small text-muted">{project.name}</span>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            ×
          </Button>
        </div>
        <span className={cn("text-small", STATUS_COLOR[worktree.status])}>
          {statusText(worktree)}: {detailText(worktree)}
        </span>
        <NoteLine worktree={worktree} />
        <Refused worktree={worktree} />
        <ServiceChips worktree={worktree} />
        <PressButton worktree={worktree} />
        <RemoveButton project={project.id} worktree={worktree} onRemoved={onClose} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:order-2">
        {tab === "gate" && <Gate gate={worktree.gate} />}
        {tab === "terminal" && <TerminalTab project={project.id} worktree={worktree} />}
        {tab === "actions" && <ActionPicker project={project.id} worktree={worktree} />}
      </div>
      <TabBar
        label="Worktree"
        tabs={TABS}
        current={tab}
        onSelect={setTab}
        className="border-t md:order-1 md:border-t-0 md:border-b"
      />
    </section>
  )
}
