// Usage: promote.mjs [from=next] [to=latest]. Idempotent and never moves `to`
// backwards: once the tags match, a run is a no-op, so the schedule alone sets
// the cadence.
import { execFileSync } from "node:child_process"

const pkg = "@pmelab/gtd"
const [from = "next", to = "latest"] = process.argv.slice(2)
const npm = (...args) => execFileSync("npm", args, { encoding: "utf8" })

const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number))
  const i = x.findIndex((n, k) => n !== y[k])
  return i !== -1 && x[i] > y[i]
}

const tags = JSON.parse(npm("view", pkg, "dist-tags", "--json"))
const [source, target] = [tags[from], tags[to]]
if (!source || (target && !newer(source, target))) {
  console.log(`${to} (${target}) is current; nothing to promote`)
} else {
  npm("dist-tag", "add", `${pkg}@${source}`, to)
  console.log(`promoted ${source} to ${to} (was ${target})`)
}
