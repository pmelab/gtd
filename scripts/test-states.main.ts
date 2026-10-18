import { FLAGS, resolveFlags } from "../src/flags/index.ts"
import { planStates, runStates, spawnTurbo } from "./test-states.ts"

const args = process.argv.slice(2)
const condense = resolveFlags(process.env).condense_failures

process.exitCode = await runStates(
  planStates(FLAGS, process.env),
  (tasks, env, live) => spawnTurbo(tasks, env, args, live),
  console.log,
  condense ? { print: (text) => process.stdout.write(text) } : undefined,
)
