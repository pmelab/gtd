import { FLAGS } from "../src/flags/index.ts"
import { planStates, runStates, spawnTurbo } from "./test-states.ts"

const args = process.argv.slice(2)

process.exitCode = await runStates(
  planStates(FLAGS, process.env),
  (tasks, env, live) => spawnTurbo(tasks, env, args, live),
  console.log,
  { print: (text) => process.stdout.write(text) },
)
