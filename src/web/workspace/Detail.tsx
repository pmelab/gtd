import { ExternalLink, X } from "lucide-react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { httpBatchLink } from "@trpc/client"
import { Component, useState, type ReactNode } from "react"
import { trpc as gateTrpc } from "../api.js"
import { App } from "../App.js"
import { Notice } from "../Notice.js"
import { Button } from "../Button.js"
import { cn } from "../cn.js"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js"
import { ActionPicker } from "./ActionPicker.js"
import { NoteLine } from "./NoteLine.js"
import { EntryTitle } from "./Now.js"
import { Retrospective } from "./Retrospective.js"
import { PressButton, Refused } from "./Press.js"
import { ServiceChips } from "./ServiceChips.js"
import { StatusBadge } from "./Status.js"
import { RemoveButton } from "./WorktreeChanges.js"
import { reasonText, worktreeName, type Entry } from "./view.js"

type Tab = "gate" | "actions" | "retrospective"

/** A crash in the gate screen stays in the Gate tab. */
class GateBoundary extends Component<{ readonly children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  override render(): ReactNode {
    return this.state.failed ? (
      <Notice tone="error" data-testid="gate-crashed">
        The gate page failed to show. Open it in a new tab.
      </Notice>
    ) : (
      this.props.children
    )
  }
}

/** The worktree's gate page, rendered inline against that worktree's own gate API. */
const InlineGate = ({ gate }: { readonly gate: string }) => {
  const [queryClient] = useState(() => new QueryClient())
  const [client] = useState(() =>
    gateTrpc.createClient({ links: [httpBatchLink({ url: `${gate}/trpc` })] }),
  )
  return (
    <gateTrpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App inline />
      </QueryClientProvider>
    </gateTrpc.Provider>
  )
}

const Gate = ({ gate, head }: { readonly gate: string; readonly head: string }) => (
  <div className="flex flex-1 flex-col" data-testid="gate-tab">
    <GateBoundary key={head}>
      <InlineGate key={head} gate={gate} />
    </GateBoundary>
  </div>
)

/** The detail's header: title, close, gate kind and link, status, why, and the press. */
const DetailHeader = ({
  entry,
  onClose,
  hideProceed,
}: {
  readonly entry: Entry
  readonly onClose: () => void
  /** The gate page shows its own Proceed. */
  readonly hideProceed: boolean
}) => {
  const { worktree } = entry
  const reason = reasonText(worktree)
  return (
    <header className="flex flex-col gap-3 px-4 pt-4 pb-5 lg:px-6 lg:pt-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 pt-1.5 text-xl leading-snug lg:pt-0.5">
          <EntryTitle entry={entry} />
        </h2>
        <Button variant="ghost" size="icon" className="-mr-2" onClick={onClose} aria-label="Close">
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {worktree.gateKind !== undefined && (
          <span className="text-base font-medium" data-testid="detail-gate-kind">
            {worktree.gateKind}
          </span>
        )}
        {worktree.gateBase !== undefined && (
          <span className="text-sm text-muted-foreground" data-testid="detail-gate-base">
            Review base: <code className="font-mono text-foreground">{worktree.gateBase}</code>
          </span>
        )}
        <Button asChild size="sm">
          <a href={worktree.gate} target="_blank" rel="noreferrer" data-testid="open-gate">
            <ExternalLink aria-hidden="true" />
            Open in new tab
          </a>
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
        <PressButton worktree={worktree} className="w-full" hideProceed={hideProceed} />
      </div>
    </header>
  )
}

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
  const { project, worktree } = entry
  const atGate = worktree.humanRest === true
  const [tab, setTab] = useState<Tab>(atGate ? "gate" : "actions")
  // Passing a gate forgets Gate, so the next gate leaves Actions selected.
  if (!atGate && tab === "gate") setTab("actions")
  return (
    <section
      className={cn(
        "flex flex-col overflow-y-auto bg-background text-foreground",
        embedded ? "min-h-0 min-w-0 flex-1" : "pt-safe pb-safe fixed inset-0 z-10",
      )}
      aria-label={`${project.name} / ${worktreeName(worktree)}`}
      data-testid="detail"
    >
      <DetailHeader
        entry={entry}
        onClose={onClose}
        hideProceed={tab === "gate" && worktree.gated === true}
      />
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next as Tab)
        }}
        className="flex-1 gap-4 px-4 pb-4 lg:px-6 lg:pb-6"
      >
        <TabsList aria-label="Worktree" className="w-full lg:w-fit">
          <TabsTrigger value="gate" disabled={!atGate} className="lg:px-4">
            Gate
          </TabsTrigger>
          <TabsTrigger value="actions" className="lg:px-4">
            Actions
          </TabsTrigger>
          <TabsTrigger value="retrospective" className="lg:px-4">
            Retrospective
          </TabsTrigger>
        </TabsList>
        {atGate && (
          <TabsContent value="gate" className="flex flex-col">
            <Gate gate={worktree.gate} head={worktree.head} />
          </TabsContent>
        )}
        <TabsContent value="actions" className="flex max-w-2xl flex-col gap-4">
          {!atGate && (
            <p className="text-sm text-muted-foreground" data-testid="no-gate-hint">
              No human gate right now
            </p>
          )}
          <ActionPicker project={project.id} worktree={worktree} />
          <RemoveButton project={project.id} worktree={worktree} onRemoved={onClose} />
        </TabsContent>
        <TabsContent value="retrospective" className="flex max-w-3xl min-w-0 flex-col gap-4">
          <Retrospective project={project.id} worktree={worktree} />
        </TabsContent>
      </Tabs>
    </section>
  )
}
