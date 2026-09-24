import type { StepRead } from "../ui/index.js"
import { Notice } from "./Notice.js"
import { FreeForm } from "./screens/FreeForm.js"
import { Plan } from "./screens/Plan.js"
import { Review } from "./screens/Review.js"
import { trpc } from "./api.js"

/** The one shape a screen can open: a clean read resting on a steering file — package 01 dropped the `mode` requirement, since an absent or unregistered mode now falls through to `FreeForm` rather than refusing. */
const openable = (step: StepRead | undefined): step is StepRead & { status: "ok"; file: string } =>
  step?.status === "ok" && step.file !== undefined

/**
 * The whole phone's navigation: `gtd ui` serves exactly one worktree resting
 * on exactly one step (package 02's own refuse-to-start gate — the server
 * never binds on a step this client can't render), so there is no fleet list
 * and no route back to one. `trpc.step`'s own `mode` picks the screen —
 * `"review"` always means `Review` (that screen's own `readSteeringFile` call
 * is hardcoded to `mode: "review"`, matching `.gtd/REVIEW.md`'s one format);
 * `"qa"` means `Plan`; anything else (absent, or an unregistered mode name)
 * falls through to `FreeForm`, which edits the file block-by-block as plain
 * markdown. Neither screen offers a way back to a list — `done` is the only
 * thing that ends the turn, and it exits the process.
 *
 * Never returns `null`: a blank white screen was package 03's own regression
 * (a phone over a tailnet with nothing on-screen to explain why) — every
 * branch below renders SOMETHING, even the in-flight and error ones.
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
    <div className="mx-auto flex h-dvh max-w-[430px] flex-col">
      {step.mode === "review" ? (
        <Review filePath={step.file} />
      ) : step.mode === "qa" ? (
        <Plan filePath={step.file} mode="qa" />
      ) : (
        <FreeForm filePath={step.file} mode={step.mode} />
      )}
    </div>
  )
}
