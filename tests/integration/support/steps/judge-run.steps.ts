import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import assert from "node:assert"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Given, Then, When } from "quickpickle"
import type { GtdWorld } from "../world.js"

// A pipeline of gtd invocations: real `sh` live, in-process in memory.
When("I run in the shell:", async (world: GtdWorld, command: string) => {
  await world.runShell(String(command))
})

// A stand-in for TypeSafe: every request gets this status and body. Live, a
// local server the spawned gtd reaches through `JEV_BASE_URL`; in memory,
// the judge's fetch itself — no network either way.
Given(
  "a judge stub server answering {int} with:",
  async (world: GtdWorld, status: number, body: string) => {
    if (world.repo !== undefined) {
      world.judgeFetch = async () =>
        new Response(String(body), { status, headers: { "Content-Type": "application/json" } })
      return
    }
    const server = createServer((req, res) => {
      req.resume()
      req.on("end", () => {
        res.writeHead(status, { "Content-Type": "application/json" })
        res.end(String(body))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const { port } = server.address() as AddressInfo
    world.envVars["JEV_BASE_URL"] = `http://127.0.0.1:${port}/v1/systemone`
    world.closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  },
)

Given("claude answers with:", (world: GtdWorld, stdout: string) => {
  world.scriptedClaude = { code: 0, stdout: `${String(stdout)}\n`, stderr: "" }
})

Given(
  "claude fails with exit {int} and stderr {string}",
  (world: GtdWorld, code: number, stderr: string) => {
    world.scriptedClaude = { code, stdout: "", stderr: `${stderr}\n` }
  },
)

Then("claude was run with {string}", (world: GtdWorld, args: string) => {
  const runs = world.claudeCalls.map((argv) => argv.join(" "))
  assert.ok(
    runs.some((run) => run.includes(args)),
    `Expected a claude run with "${args}". Got:\n${runs.join("\n")}`,
  )
})

// Points the user-level config home at a fresh directory, so the machine
// running the suite never leaks its own ~/.config/gtd/judge.json — in memory,
// a path no real file sits under.
Given("a user-level judge config with:", (world: GtdWorld, json: string) => {
  const home = (world.envVars["XDG_CONFIG_HOME"] ??=
    world.repo !== undefined ? "/inmem-config" : mkdtempSync(join(tmpdir(), "gtd-config-")))
  const path = join(home, "gtd", "judge.json")
  if (world.repo !== undefined) {
    world.userFiles.set(path, String(json))
    return
  }
  mkdirSync(join(home, "gtd"), { recursive: true })
  writeFileSync(path, String(json))
})
