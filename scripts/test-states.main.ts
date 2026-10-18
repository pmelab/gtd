import { FLAGS } from "../src/flags/index.ts"
import { flagValue, planStates, runStates, spawnTurbo } from "./test-states.ts"

const args = process.argv.slice(2)

process.exitCode = runStates(
  planStates(FLAGS, process.env),
  (tasks, env) => spawnTurbo(tasks, env, args),
  console.log,
  {
    full: flagValue(args, "--output-logs") === "full",
    collapse: (flagValue(args, "--log-prefix") ?? "task") === "task",
  },
)
