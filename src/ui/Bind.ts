import type * as os from "node:os"

/**
 * Tailscale's CGNAT range: first octet 100, second octet 64-127
 * (100.64.0.0/10). Scanning for this avoids shelling out to a `tailscale`
 * binary, which is not installed on this machine and not worth acquiring.
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
  let best: { name: string; address: string } | undefined

  for (const name of Object.keys(interfaces).sort()) {
    const infos = interfaces[name]
    if (!infos) continue
    const addresses = infos
      .filter((info) => info.family === "IPv4" && isTailscaleIPv4(info.address))
      .map((info) => info.address)
      .sort()
    const address = addresses[0]
    if (address === undefined) continue
    if (best === undefined || name < best.name || (name === best.name && address < best.address)) {
      best = { name, address }
    }
  }

  return best?.address
}
