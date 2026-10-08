// Doors are the workflow's named shortcuts into a process (`gtd doors`). gtd
// prints the script that starts one; running it is the driver's job, as with
// every git write gtd plans. The mod hardcodes no door: it asks gtd.

import type { ShipIo, Shipped } from "./ship"

export type Door = {
  name: string
  workflow: string
  args: { name: string; optional: boolean }[]
}

const fail = (text: string): Shipped => ({ ok: false, text })

// Every door the repository offers; none when gtd cannot say.
export async function doors(io: ShipIo): Promise<Door[]> {
  const listed = await io.run(["gtd", "doors", "--json"])
  if (listed.code !== 0) return []
  try {
    return JSON.parse(listed.out) as Door[]
  } catch {
    return []
  }
}

export async function enter(io: ShipIo, name: string, args: string[]): Promise<Shipped> {
  const argv = ["gtd", "door", name, ...args]
  const planned = await io.run(argv)
  if (planned.code !== 0)
    return fail(planned.err.trim() || `${argv.join(" ")} exited ${planned.code}`)
  const started = await io.run(["sh", "-c", planned.out])
  if (started.code !== 0) return fail(`The door script failed.\n${started.err.trim()}`)
  return { ok: true, text: `Started ${name}.` }
}
