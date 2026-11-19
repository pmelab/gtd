import { ExternalLink, X } from "lucide-react"
import { useState } from "react"
import { Button } from "../Button.js"
import { cn } from "../cn.js"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js"
import { ActionPicker } from "./ActionPicker.js"
import { NoteLine } from "./NoteLine.js"
import { EntryTitle } from "./Now.js"
import { PressButton, Refused } from "./Press.js"
import { ServiceChips } from "./ServiceChips.js"
import { StatusBadge } from "./Status.js"
import { RemoveButton } from "./WorktreeChanges.js"
import { reasonText, worktreeName, type Entry } from "./view.js"

type Tab = "gate" | "actions"

/** The worktree's gate page, embedded from the URL the API names, with a way out to a full tab. */
const Gate = ({ gate, head }: { readonly gate: string; readonly head: string }) => (
  <div className="flex min-h-[60dvh] flex-1 flex-col gap-3" data-testid="gate-tab">
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium text-muted-foreground">Gate page</span>
      <Button asChild size="sm">
        <a href={gate} target="_blank" rel="noreferrer" data-testid="open-gate">
          <ExternalLink aria-hidden="true" />
          Open in new tab
        </a>
      </Button>
    </div>
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
      {/* The rest moves only with HEAD: a new commit loads the page again, for the new rest.
          A colour scheme that differs from the framed page's paints the frame opaque white in
          dark mode; "normal" keeps a blank or unstyled page transparent over the card. */}
      <iframe
        key={head}
        className="w-full flex-1 border-0 bg-card [color-scheme:normal]"
        src={gate}
        title="Gate page"
      />
    </div>
  </div>
)

/**
 * A worktree's detail: its status and press, then the gate page and Actions
 * as tabs. On a phone it covers the screen; on desktop it is the right pane.
 */
export const Detail = ({
  entry,
  onClose,
  embedded = false,
}: {
  readonly entry: Entry
  readonly onClose: () => void
  /** Desktop: a pane beside the list instead of a screen over it. */
  readonly embedded?: boolean
}) => {
  const [tab, setTab] = useState<Tab>("gate")
  const { project, worktree } = entry
  const reason = reasonText(worktree)
  return (
    <section
      className={cn(
        "flex flex-col overflow-y-auto bg-background text-foreground",
        embedded ? "min-h-0 min-w-0 flex-1" : "fixed inset-0 z-10",
      )}
      aria-label={`${project.name} / ${worktreeName(worktree)}`}
      data-testid="detail"
    >
      <header className="flex flex-col gap-3 px-4 pt-4 pb-5 lg:px-6 lg:pt-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 pt-1.5 text-xl leading-snug lg:pt-0.5">
            <EntryTitle entry={entry} />
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-2"
            onClick={onClose}
            aria-label="Close"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <StatusBadge worktree={worktree} className="self-start" />
        {reason !== "" && (
          <p className="max-w-prose text-base" data-testid="detail-reason">
            {reason}
          </p>
        )}
        <NoteLine worktree={worktree} />
        <Refused worktree={worktree} className="max-w-prose" />
        <ServiceChips worktree={worktree} />
        <div className="flex sm:max-w-xs">
          <PressButton worktree={worktree} className="w-full" />
        </div>
      </header>
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next as Tab)
        }}
        className="flex-1 gap-4 px-4 pb-4 lg:px-6 lg:pb-6"
      >
        <TabsList aria-label="Worktree" className="w-full lg:w-fit">
          <TabsTrigger value="gate" className="lg:px-4">
            Gate
          </TabsTrigger>
          <TabsTrigger value="actions" className="lg:px-4">
            Actions
          </TabsTrigger>
        </TabsList>
        <TabsContent value="gate" className="flex flex-col">
          <Gate gate={worktree.gate} head={worktree.head} />
        </TabsContent>
        <TabsContent value="actions" className="flex max-w-2xl flex-col gap-4">
          <ActionPicker project={project.id} worktree={worktree} />
          <RemoveButton project={project.id} worktree={worktree} onRemoved={onClose} />
        </TabsContent>
      </Tabs>
    </section>
  )
}
