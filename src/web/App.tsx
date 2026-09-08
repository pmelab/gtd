import type { Step, StepRead } from "../ui/Beat.js"
import { Plan } from "./screens/Plan.js"
import { Review } from "./screens/Review.js"
import { trpc } from "./api.js"

/**
 * The one shape a screen can open: a clean read resting on a steering file.
 * Package 02's own refuse-to-start gate means the server never binds on
 * anything else, so the `false` branch is defensive, not a production shape.
 */
const openable = (step: StepRead | undefined): step is Step & { file: string } =>
  step?.status === "ok" && step.file !== undefined

/**
 * The whole phone's navigation: `gtd ui` serves exactly one worktree resting
 * on exactly one step (package 02's own refuse-to-start gate — the server
 * never binds on a step this client can't render), so there is no fleet list
 * and no route back to one. `trpc.step`'s `mode` picks the screen — `"review"`
 * always means `Review` (that screen's own `readSteeringFile` call is
 * hardcoded to `mode: "review"`, matching `.gtd/REVIEW.md`'s one format);
 * anything else means `Plan`. Neither screen offers a way back to a list —
 * `done` is the only thing that ends the turn, and it exits the process.
 */
export const App = () => {
  const step = trpc.step.useQuery().data

  if (!openable(step)) {
    return null
  }

  return (
    <div style={{ maxWidth: 390, margin: "0 auto" }}>
      {step.mode === "review" ? (
        <Review worktreePath={step.path} filePath={step.file} />
      ) : (
        <Plan filePath={step.file} mode={step.mode ?? ""} />
      )}
    </div>
  )
}
