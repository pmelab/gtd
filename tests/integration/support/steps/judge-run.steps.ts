import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { Given, When } from "quickpickle"
import type { GtdWorld } from "../world.js"

// `@live` only — the pipe between gtd invocations is the thing under test.
When("I run in the shell:", async (world: GtdWorld, command: string) => {
  await world.runShell(String(command))
})

// A local stand-in for TypeSafe: every request gets this status and body, and
// the spawned gtd is pointed at it through `JEV_BASE_URL` — no real network.
Given(
  "a judge stub server answering {int} with:",
  async (world: GtdWorld, status: number, body: string) => {
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
