import { RotateCw } from "lucide-react"
import type { ReactNode } from "react"
import type { StepRead } from "../ui/index.js"
import { Button } from "./Button.js"
import { cn } from "./cn.js"
import { Notice } from "./Notice.js"
import { Document, DocumentSkeleton } from "./screens/Document.js"
import { trpc } from "./api.js"

/** The one shape a screen can open: a clean read resting on a steering file. */
const openable = (step: StepRead | undefined): step is StepRead & { status: "ok"; file: string } =>
  step?.status === "ok" && step.file !== undefined

const Reload = () => (
  <Button variant="secondary" className="mt-3" onClick={() => window.location.reload()}>
    <RotateCw aria-hidden="true" />
    Reload
  </Button>
)

const StatePage = ({
  children,
  inline,
}: {
  readonly children: ReactNode
  readonly inline: boolean
}) => (
  <main
    className={
      inline
        ? "py-2"
        : "min-h-dvh bg-background px-4 pt-[calc(2rem+var(--safe-top,env(safe-area-inset-top)))] pb-[calc(2rem+var(--safe-bottom,env(safe-area-inset-bottom)))]"
    }
  >
    {children}
  </main>
)

const NOTICE = "mx-auto max-w-2xl"

/**
 * `gtd ui` serves exactly one worktree resting on exactly one step, so there
 * is no list to go back to: the document screen opens the step's steering
 * file, and `done` hands the turn back.
 *
 * Never renders nothing: a blank screen on a phone over a tailnet explains
 * nothing.
 */
// fallow-ignore-next-line complexity
export const App = ({ inline = false }: { readonly inline?: boolean }) => {
  const query = trpc.step.useQuery()
  const step = query.data

  if (query.isLoading) {
    return (
      <div
        data-testid="app-loading"
        aria-busy="true"
        className={inline ? "" : "min-h-dvh bg-background"}
      >
        <DocumentSkeleton label="Loading the gate page…" />
      </div>
    )
  }

  if (query.isError || step === undefined) {
    const detail = query.isError ? query.error.message : "no step was reported."
    return (
      <StatePage inline={inline}>
        <Notice tone="error" data-testid="app-query-error" className={NOTICE}>
          <p className="m-0">Could not reach the server: {detail}</p>
          <p className="m-0 mt-1 text-muted-foreground">
            Check that gtd is still running on your computer, then reload this page.
          </p>
          <Reload />
        </Notice>
      </StatePage>
    )
  }

  if (step.status === "broken") {
    return (
      <StatePage inline={inline}>
        <Notice tone="error" data-testid="app-broken" className={NOTICE}>
          <p className="m-0">
            {step.repo} / {step.branch} cannot be read: {step.detail}
          </p>
          <p className="m-0 mt-1 text-muted-foreground">
            Fix the worktree on your computer, then reload this page.
          </p>
          <Reload />
        </Notice>
      </StatePage>
    )
  }

  if (step.status === "moved-on") {
    return (
      <StatePage inline={inline}>
        <Notice data-testid="app-moved-on" className={NOTICE}>
          This turn is over and the server is exiting. You can close this page.
        </Notice>
      </StatePage>
    )
  }

  if (!openable(step)) {
    return (
      <StatePage inline={inline}>
        <Notice tone="error" data-testid="app-unrenderable" className={NOTICE}>
          {`"${step.label}" has nothing this page can show. Continue on your computer.`}
        </Notice>
      </StatePage>
    )
  }

  return (
    <div className={cn("relative flex flex-col", !inline && "pb-safe h-dvh bg-background")}>
      <Document
        inline={inline}
        filePath={step.file}
        context={{ repo: step.repo, branch: step.branch, label: step.label }}
      />
    </div>
  )
}
