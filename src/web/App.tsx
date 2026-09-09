import type { StepRead } from "../ui/Beat.js"
import { Plan } from "./screens/Plan.js"
import { Review } from "./screens/Review.js"
import { trpc } from "./api.js"

/** The one shape a screen can open: a clean read resting on a steering file with a registered mode — package 02's own refuse-to-start gate means the server never binds on anything else, so the `false` branch is defensive, not a production shape. */
const openable = (
  step: StepRead | undefined,
): step is StepRead & { status: "ok"; file: string; mode: string } =>
  step?.status === "ok" && step.file !== undefined && step.mode !== undefined

/**
 * The whole phone's navigation: `gtd ui` serves exactly one worktree resting
 * on exactly one step (package 02's own refuse-to-start gate — the server
 * never binds on a step this client can't render), so there is no fleet list
 * and no route back to one. `trpc.step`'s own `mode` picks the screen —
 * `"review"` always means `Review` (that screen's own `readSteeringFile` call
 * is hardcoded to `mode: "review"`, matching `.gtd/REVIEW.md`'s one format);
 * anything else means `Plan`. Neither screen offers a way back to a list —
 * `done` is the only thing that ends the turn, and it exits the process.
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
      <div data-testid="app-loading" aria-busy="true" style={{ padding: 16 }}>
        Loading…
      </div>
    )
  }

  if (query.isError) {
    return (
      <div data-testid="app-query-error" style={{ padding: 16 }}>
        Could not reach the server: {query.error.message}
      </div>
    )
  }

  if (step === undefined) {
    return (
      <div data-testid="app-query-error" style={{ padding: 16 }}>
        Could not reach the server: no step was reported.
      </div>
    )
  }

  if (step.status === "broken") {
    return (
      <div data-testid="app-broken" style={{ padding: 16 }}>
        {step.detail}
      </div>
    )
  }

  if (step.status === "moved-on") {
    return (
      <div data-testid="app-moved-on" style={{ padding: 16 }}>
        This turn is over — the server is exiting.
      </div>
    )
  }

  if (!openable(step)) {
    return (
      <div data-testid="app-unrenderable" style={{ padding: 16 }}>
        {`"${step.label}" has nothing this screen can render.`}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 390, margin: "0 auto" }}>
      {step.mode === "review" ? (
        <Review filePath={step.file} />
      ) : (
        <Plan filePath={step.file} mode={step.mode} />
      )}
    </div>
  )
}
