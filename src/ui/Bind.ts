import type * as os from "node:os"

/**
 * Tailscale's CGNAT range: first octet 100, second octet 64-127
 * (100.64.0.0/10). This is the BIND address only — `Tailscale.ts` shells out
 * to the `tailscale` binary separately to resolve the DISPLAYED hostname and
 * certificate, a job this scan cannot do.
 */
const isTailscaleIPv4 = (address: string): boolean => {
  const parts = address.split(".")
  if (parts.length !== 4) return false
  const [first, second] = parts.map((p) => Number(p))
  return first === 100 && second !== undefined && second >= 64 && second <= 127
}

/**
 * Picks a deterministic bind host from a network interfaces map: the
 * lexicographically smallest interface name, then smallest IPv4 address,
 * among interfaces carrying a Tailscale CGNAT address. Takes the map as a
 * parameter (rather than calling `os.networkInterfaces()` itself) so tests
 * can inject fake interfaces without touching the real network.
 */
export const pickBindHost = (
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
): string | undefined => {
  for (const name of Object.keys(interfaces).sort()) {
    const address = (interfaces[name] ?? [])
      .filter((info) => info.family === "IPv4" && isTailscaleIPv4(info.address))
      .map((info) => info.address)
      .sort()[0]
    if (address !== undefined) return address
  }

  return undefined
}
