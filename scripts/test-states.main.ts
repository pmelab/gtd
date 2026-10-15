import { FLAGS } from "../src/flags/index.ts"
import { planStates, runStates, spawnTurbo } from "./test-states.ts"

process.exitCode = runStates(planStates(FLAGS, process.env), spawnTurbo, console.log)
