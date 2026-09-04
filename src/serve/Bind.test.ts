import type * as os from "node:os"
import { describe, expect, it } from "vitest"
import { pickBindHost } from "./Bind.js"

type Interfaces = NodeJS.Dict<os.NetworkInterfaceInfo[]>

const ipv4 = (address: string): os.NetworkInterfaceInfo =>
  ({
    address,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal: false,
    cidr: `${address}/32`,
  }) as os.NetworkInterfaceInfo

describe("pickBindHost", () => {
  it("chooses an interface with an IPv4 in the Tailscale CGNAT range 100.64.0.0/10", () => {
    const interfaces: Interfaces = {
      eth0: [ipv4("192.168.1.5")],
      tailscale0: [ipv4("100.90.10.2")],
    }

    expect(pickBindHost(interfaces)).toBe("100.90.10.2")
  })

  it("resolves deterministically across several matching interfaces, regardless of key order", () => {
    const inOrderA: Interfaces = {
      tailscale0: [ipv4("100.90.10.2")],
      utun3: [ipv4("100.64.5.1")],
    }
    const inOrderB: Interfaces = {
      utun3: [ipv4("100.64.5.1")],
      tailscale0: [ipv4("100.90.10.2")],
    }

    // Tie-break rule: lexicographically smallest interface name wins ("tailscale0" < "utun3").
    expect(pickBindHost(inOrderA)).toBe("100.90.10.2")
    expect(pickBindHost(inOrderB)).toBe(pickBindHost(inOrderA))
  })

  it("picks the smallest IPv4 address when one interface carries several matching addresses", () => {
    const interfaces: Interfaces = {
      tailscale0: [ipv4("100.90.10.9"), ipv4("100.90.10.2")],
    }

    expect(pickBindHost(interfaces)).toBe("100.90.10.2")
  })

  it("returns undefined when no interface has an IPv4 in the Tailscale range", () => {
    const interfaces: Interfaces = {
      eth0: [ipv4("192.168.1.5")],
      lo: [ipv4("127.0.0.1")],
    }

    expect(pickBindHost(interfaces)).toBeUndefined()
  })

  it("ignores non-Tailscale ranges that merely start with 100, and IPv6 addresses", () => {
    const interfaces: Interfaces = {
      eth0: [ipv4("100.50.0.1"), ipv4("100.200.0.1")],
      eth1: [{ ...ipv4("100.90.10.2"), family: "IPv6" } as os.NetworkInterfaceInfo],
    }

    expect(pickBindHost(interfaces)).toBeUndefined()
  })
})
