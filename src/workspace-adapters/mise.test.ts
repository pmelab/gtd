import { execFile, execFileSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { actionsContract, type ActionSight } from "../workspace-testkit/index.js"
import { mise } from "./mise.js"

const which = (command: string): string | undefined => {
  try {
    return execFileSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" }).trim()
  } catch {
    return undefined
  }
}

const MISE = which("mise")

// The contract action prints what it got, as JSON, from mise's `usage_*` variables.
const CONTRACT_TOML = `
[tasks."start:contract"]
description = "Contract"
usage = '''
arg "<note>" help="What to note"
flag "--title <title>"
flag "--mode <mode>" { choices "fast" "slow" }
flag "--dry" help="Change nothing"
'''
run = '''
node -e 'const e = process.env; process.stdout.write(JSON.stringify({ note: e.usage_note || undefined, title: e.usage_title || undefined, mode: e.usage_mode || undefined, dry: e.usage_dry === "true" }))'
'''

[tasks."gate:approve"]
run = "true"

[tasks."error:fix"]
description = "Fix it"
run = "true"

[tasks."any:shell"]
description = "Open a shell"
run = "true"

[tasks."gate:secret"]
hide = true
run = "true"

[tasks.build]
run = "true"
`

let root = ""
let trusted: string | undefined

const workspace = (): string => {
  const dir = mkdtempSync(join(root, "wt-"))
  writeFileSync(join(dir, "mise.toml"), CONTRACT_TOML)
  return dir
}

describe.skipIf(MISE === undefined)("mise", () => {
  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "gtd-mise-")))
    // Trust the scratch configs without writing to the person's mise state.
    trusted = process.env["MISE_TRUSTED_CONFIG_PATHS"]
    process.env["MISE_TRUSTED_CONFIG_PATHS"] = root
  })
  afterAll(() => {
    if (trusted === undefined) delete process.env["MISE_TRUSTED_CONFIG_PATHS"]
    else process.env["MISE_TRUSTED_CONFIG_PATHS"] = trusted
    rmSync(root, { recursive: true, force: true })
  })

  describe("passes the actions contract", () => {
    for (const contractCase of actionsContract({
      setup: async () => {
        const worktree = workspace()
        return {
          adapter: mise(),
          worktree,
          id: "start:contract",
          received: (argv) =>
            new Promise<ActionSight>((resolve, reject) => {
              execFile(argv[0]!, argv.slice(1), { cwd: worktree }, (error, stdout, stderr) => {
                if (error !== null) reject(new Error(`${error.message}\n${stderr}`))
                else resolve(JSON.parse(stdout) as ActionSight)
              })
            }),
          dispose: async () => rmSync(worktree, { recursive: true, force: true }),
        }
      },
    })) {
      it(contractCase.name, contractCase.run, 60_000)
    }
  })

  it("maps the task prefixes to worktree statuses and leaves other tasks out", async () => {
    const worktree = workspace()
    const actions = await mise().list(worktree)
    expect(
      actions
        .map(({ id, label, status }) => ({ id, label, status }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    ).toEqual([
      { id: "any:shell", label: "Open a shell", status: "any" },
      { id: "error:fix", label: "Fix it", status: "error" },
      { id: "gate:approve", label: "gate:approve", status: "needsYou" },
      { id: "start:contract", label: "Contract", status: "idle" },
    ])
  }, 60_000)

  it("refuses a task that is not an action", async () => {
    await expect(mise().argv(workspace(), "build", {})).rejects.toMatchObject({
      adapter: "actions",
      op: "argv",
    })
  })
})
