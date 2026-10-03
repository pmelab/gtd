// The Claude Code plugin ships inside the npm package, and an npm-sourced
// plugin updates only when its manifest's version changes: release it in step.
import { readFileSync, writeFileSync } from "node:fs"

const { version } = JSON.parse(readFileSync("package.json", "utf8"))
const path = ".claude-plugin/plugin.json"
const manifest = JSON.parse(readFileSync(path, "utf8"))
writeFileSync(path, JSON.stringify({ ...manifest, version }, null, 2) + "\n")
