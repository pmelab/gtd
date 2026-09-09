import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { CommandRunner } from "../CommandRunner.js"
import { parseTailscaleStatus, probeTailscaleStatus } from "./Tailscale.js"

const running = (self: Record<string, unknown>): string =>
  JSON.stringify({ BackendState: "Running", Self: self })

describe("parseTailscaleStatus", () => {
  it("returns undefined on unparseable JSON", () => {
    expect(parseTailscaleStatus("not json")).toBeUndefined()
  })

  it("returns undefined when BackendState is not Running", () => {
    expect(
      parseTailscaleStatus(
        JSON.stringify({
          BackendState: "Stopped",
          Self: { DNSName: "host.tailnet.ts.net.", CertDomains: ["host.tailnet.ts.net"] },
        }),
      ),
    ).toBeUndefined()
  })

  it("returns undefined when Self is missing", () => {
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: "Running" }))).toBeUndefined()
  })

  it("returns the hostname and certDomains when CertDomains is present", () => {
    const status = parseTailscaleStatus(
      running({ DNSName: "host.tailnet.ts.net.", CertDomains: ["host.tailnet.ts.net"] }),
    )
    expect(status).toEqual({
      hostname: "host.tailnet.ts.net",
      certDomains: ["host.tailnet.ts.net"],
    })
  })

  it("falls back to DNSName, with its trailing dot stripped, when CertDomains is empty", () => {
    const status = parseTailscaleStatus(
      running({ DNSName: "philipps-macbook-pro-m5.tailb2e719.ts.net.", CertDomains: [] }),
    )
    expect(status).toEqual({
      hostname: "philipps-macbook-pro-m5.tailb2e719.ts.net",
      certDomains: [],
    })
  })

  it("returns undefined when MagicDNS is off — neither CertDomains nor DNSName gives a name", () => {
    expect(parseTailscaleStatus(running({ CertDomains: [] }))).toBeUndefined()
    expect(parseTailscaleStatus(running({ DNSName: "", CertDomains: [] }))).toBeUndefined()
  })
})

describe("probeTailscaleStatus", () => {
  it("runs `tailscale status --json` through CommandRunner", async () => {
    const commands: string[] = []
    const runner = CommandRunner.layer((command) => {
      commands.push(command)
      return Effect.succeed({
        status: 0,
        output: running({ DNSName: "host.tailnet.ts.net.", CertDomains: ["host.tailnet.ts.net"] }),
      })
    })
    const status = await Effect.runPromise(probeTailscaleStatus().pipe(Effect.provide(runner)))
    expect(commands).toEqual(["tailscale status --json"])
    expect(status).toEqual({
      hostname: "host.tailnet.ts.net",
      certDomains: ["host.tailnet.ts.net"],
    })
  })

  it("resolves undefined, never a failed Effect, when the spawn itself fails (binary absent)", async () => {
    const runner = CommandRunner.layer(() => Effect.fail(new Error("spawn ENOENT")))
    const status = await Effect.runPromise(probeTailscaleStatus().pipe(Effect.provide(runner)))
    expect(status).toBeUndefined()
  })

  it("resolves undefined, never a failed Effect, on a non-zero exit", async () => {
    const runner = CommandRunner.layer(() => Effect.succeed({ status: 1, output: "not logged in" }))
    const status = await Effect.runPromise(probeTailscaleStatus().pipe(Effect.provide(runner)))
    expect(status).toBeUndefined()
  })
})
