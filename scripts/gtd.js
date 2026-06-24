#!/usr/bin/env node
// @ts-nocheck
import { existsSync, renameSync, chmodSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const dir = import.meta.dirname
const bundlePath = join(dir, "gtd.bundle.mjs")
const tmpPath = bundlePath + ".tmp"
const pkg = JSON.parse(readFileSync(join(dir, "../package.json"), "utf8"))
const version = pkg.version
const downloadUrl =
  version && version !== "0.0.0-development"
    ? `https://github.com/pmelab/gtd/releases/download/v${version}/gtd.bundle.mjs`
    : "https://github.com/pmelab/gtd/releases/latest/download/gtd.bundle.mjs"

if (!existsSync(bundlePath)) {
  let res
  try {
    res = await fetch(downloadUrl)
  } catch (err) {
    process.stderr.write(
      `gtd: network error downloading bundle from ${downloadUrl}\nRun: npm run build\n`,
    )
    process.exit(1)
  }
  if (!res.ok) {
    process.stderr.write(
      `gtd: download failed (HTTP ${res.status}) from ${downloadUrl}\nRun: npm run build\n`,
    )
    process.exit(1)
  }
  await writeFile(tmpPath, Buffer.from(await res.arrayBuffer()))
  renameSync(tmpPath, bundlePath)
  chmodSync(bundlePath, 0o755)
}

await import(pathToFileURL(bundlePath).href)
