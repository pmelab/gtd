import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll } from "vitest"

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Temp dir holding a `claude` shell shim; removed after the test file. */
export const claudeShim = (script: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "gtd-claude-shim-"))
  dirs.push(dir)
  writeFileSync(join(dir, "claude"), `#!/bin/sh\n${script}\n`)
  chmodSync(join(dir, "claude"), 0o755)
  return dir
}
