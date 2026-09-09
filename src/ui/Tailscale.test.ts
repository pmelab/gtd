import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { CommandRunner } from "../CommandRunner.js"
import { parseTailscaleStatus, probeTailscaleStatus } from "./Tailscale.js"

const running = (self: Record<string, unknown>, top: Record<string, unknown> = {}): string =>
  JSON.stringify({ BackendState: "Running", ...top, Self: self })

describe("parseTailscaleStatus", () => {
  it("returns undefined on unparseable JSON", () => {
    expect(parseTailscaleStatus("not json")).toBeUndefined()
  })

  it("returns undefined when BackendState is not Running", () => {
    expect(
      parseTailscaleStatus(
        JSON.stringify({
          BackendState: "Stopped",
          CertDomains: ["host.tailnet.ts.net"],
          Self: { DNSName: "host.tailnet.ts.net." },
        }),
      ),
    ).toBeUndefined()
  })

  it("returns undefined when Self is missing", () => {
    expect(
      parseTailscaleStatus(
        JSON.stringify({ BackendState: "Running", CertDomains: ["host.tailnet.ts.net"] }),
      ),
    ).toBeUndefined()
  })

  it("returns the hostname and certDomains when top-level CertDomains is present", () => {
    const status = parseTailscaleStatus(
      running({ DNSName: "host.tailnet.ts.net." }, { CertDomains: ["host.tailnet.ts.net"] }),
    )
    expect(status).toEqual({
      hostname: "host.tailnet.ts.net",
      certDomains: ["host.tailnet.ts.net"],
    })
  })

  it("falls back to DNSName, with its trailing dot stripped, when CertDomains is empty", () => {
    const status = parseTailscaleStatus(
      running({ DNSName: "philipps-macbook-pro-m5.tailb2e719.ts.net." }, { CertDomains: [] }),
    )
    expect(status).toEqual({
      hostname: "philipps-macbook-pro-m5.tailb2e719.ts.net",
      certDomains: [],
    })
  })

  it("returns undefined when MagicDNS is off — neither top-level CertDomains nor DNSName gives a name", () => {
    expect(parseTailscaleStatus(running({}, { CertDomains: [] }))).toBeUndefined()
    expect(parseTailscaleStatus(running({ DNSName: "" }, { CertDomains: [] }))).toBeUndefined()
  })

  it("returns a stripped hostname and empty certDomains when certs are disabled but MagicDNS is on", () => {
    const status = parseTailscaleStatus(running({ DNSName: "host.tailnet.ts.net." }))
    expect(status).toEqual({
      hostname: "host.tailnet.ts.net",
      certDomains: [],
    })
  })

  // Verbatim capture of `tailscale status --json` on a `Running` node with
  // HTTPS certs enabled, node identity redacted to the `tailb2e719.ts.net`
  // tailnet names and `Peer` reduced to `{}`. Ground truth for the top-level
  // `CertDomains` shape — a future reshape should be checked against this,
  // not another hand-written guess.
  const REAL_CAPTURE = JSON.stringify({
    Version: "1.76.1-tea5c5e9df-gebd52ea52",
    TUN: true,
    BackendState: "Running",
    HaveNodeKey: true,
    TailscaleIPs: ["100.90.1.2", "fd7a:115c:a1e0::1234:5678"],
    Self: {
      ID: "n1CNTRL",
      PublicKey: "nodekey:redacted",
      HostName: "philipps-macbook-pro-m5",
      DNSName: "philipps-macbook-pro-m5.tailb2e719.ts.net.",
      OS: "macOS",
      UserID: 1,
      TailscaleIPs: ["100.90.1.2", "fd7a:115c:a1e0::1234:5678"],
      Online: true,
      ExitNodeOption: false,
      Active: true,
      PeerAPIURL: ["http://100.90.1.2:1234"],
      Capabilities: ["https://tailscale.com/cap/is-admin"],
      InNetworkMap: true,
      InMagicSock: true,
      InEngine: true,
    },
    Peer: {},
    CertDomains: ["philipps-macbook-pro-m5.tailb2e719.ts.net"],
    MagicDNSSuffix: "tailb2e719.ts.net",
    CurrentTailnet: {
      Name: "tailb2e719.ts.net",
      MagicDNSSuffix: "tailb2e719.ts.net",
      MagicDNSEnabled: true,
    },
  })

  it("has no key matching /Cert/i under Self in the real capture", () => {
    const parsed = JSON.parse(REAL_CAPTURE) as { Self: Record<string, unknown> }
    expect(Object.keys(parsed.Self).some((key) => /Cert/i.test(key))).toBe(false)
  })

  it("parses the real capture into the expected hostname and certDomains", () => {
    expect(parseTailscaleStatus(REAL_CAPTURE)).toEqual({
      hostname: "philipps-macbook-pro-m5.tailb2e719.ts.net",
      certDomains: ["philipps-macbook-pro-m5.tailb2e719.ts.net"],
    })
  })
})

describe("probeTailscaleStatus", () => {
  it("runs `tailscale status --json` through CommandRunner", async () => {
    const commands: string[] = []
    const runner = CommandRunner.layer((command) => {
      commands.push(command)
      return Effect.succeed({
        status: 0,
        output: running(
          { DNSName: "host.tailnet.ts.net." },
          { CertDomains: ["host.tailnet.ts.net"] },
        ),
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
