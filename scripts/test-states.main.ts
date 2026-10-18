import { FLAGS } from "../src/flags/index.ts"
import { planStates, runOptions, runStates, spawnTurbo } from "./test-states.ts"

const args = process.argv.slice(2)

process.exitCode = runStates(
  planStates(FLAGS, process.env),
  (tasks, env) => spawnTurbo(tasks, env, args),
  console.log,
  runOptions(args),
)
