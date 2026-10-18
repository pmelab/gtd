import { FLAGS } from "../src/flags/index.ts"
import { planStates, runStates, spawnTurbo } from "./test-states.ts"

const args = process.argv.slice(2)
const io = {
  out: (text: string) => process.stdout.write(text),
  err: (text: string) => process.stderr.write(text),
  tty: process.stdout.isTTY === true,
}

process.exitCode = await runStates(
  planStates(FLAGS, process.env),
  (tasks, env, live) => spawnTurbo(tasks, env, args, live, io),
  console.log,
  io.out,
)
