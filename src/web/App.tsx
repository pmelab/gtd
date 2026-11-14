import type { StepRead } from "../ui/index.js"
import { Notice } from "./Notice.js"
import { Document } from "./screens/Document.js"
import { trpc } from "./api.js"

/** The one shape a screen can open: a clean read resting on a steering file. */
const openable = (step: StepRead | undefined): step is StepRead & { status: "ok"; file: string } =>
  step?.status === "ok" && step.file !== undefined

/**
 * The whole phone's navigation: `gtd ui` serves exactly one worktree resting
 * on exactly one step, so there is no list to go back to — the document
 * screen opens the step's steering file, and `done` hands the turn back.
 *
 * Never returns `null`: a blank screen on a phone over a tailnet explains
 * nothing, so every branch below renders something.
 */
// fallow-ignore-next-line complexity
export const App = () => {
  const query = trpc.step.useQuery()
  const step = query.data

  if (query.isLoading) {
    return (
      <Notice data-testid="app-loading" aria-busy="true">
        Loading…
      </Notice>
    )
  }

  if (query.isError) {
    return (
      <Notice tone="error" data-testid="app-query-error">
        Could not reach the server: {query.error.message}
      </Notice>
    )
  }

  if (step === undefined) {
    return (
      <Notice tone="error" data-testid="app-query-error">
        Could not reach the server: no step was reported.
      </Notice>
    )
  }

  if (step.status === "broken") {
    return (
      <Notice tone="error" data-testid="app-broken">
        {step.detail}
      </Notice>
    )
  }

  if (step.status === "moved-on") {
    return <Notice data-testid="app-moved-on">This turn is over — the server is exiting.</Notice>
  }

  if (!openable(step)) {
    return (
      <Notice tone="error" data-testid="app-unrenderable">
        {`"${step.label}" has nothing this screen can render.`}
      </Notice>
    )
  }

  return (
    <div className="relative mx-auto flex h-dvh max-w-[430px] flex-col">
      <Document filePath={step.file} />
    </div>
  )
}
