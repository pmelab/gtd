import { Before, Given, When } from "quickpickle"
import { afterAll } from "vitest"
import { execFile as execFileCb } from "node:child_process"
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { promisify } from "node:util"
import type { GtdWorld } from "../world.js"

const execFile = promisify(execFileCb)
const PROJECT_ROOT = resolve(import.meta.dirname, "../../../..")

// What a consumer has beside gtd: typescript for the types, the optional peers
// `./testkit` names. Linked from this checkout rather than installed, so the
// tarball is the one thing npm fetches: their own trees resolving against the
// live registry was a source of flaky runs.
const COMPANIONS = ["typescript", "vitest", "quickpickle", "@types/node"]

// Packed and installed once per feature file: npm, not gtd, is the slow part.
let installed: Promise<string> | undefined
let tarballDir: string | undefined
afterAll(() => {
  if (tarballDir !== undefined) rmSync(tarballDir, { recursive: true, force: true })
})
const installedConsumer = (): Promise<string> =>
  (installed ??= (async () => {
    const dir = (tarballDir = mkdtempSync(join(tmpdir(), "gtd-tarball-")))
    const { stdout } = await execFile(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", dir],
      { cwd: PROJECT_ROOT },
    )
    const [{ filename }] = JSON.parse(stdout) as [{ readonly filename: string }]
    const consumer = join(dir, "consumer")
    mkdirSync(consumer)
    writeFileSync(
      join(consumer, "package.json"),
      `${JSON.stringify({ name: "consumer", private: true, type: "module" }, null, 2)}\n`,
    )
    // `--omit=peer`: the companions below are gtd's peers, linked, not fetched.
    await execFile(
      "npm",
      [
        "install",
        "--prefer-offline",
        "--omit=peer",
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        join(dir, filename),
      ],
      { cwd: consumer, timeout: 180_000 },
    )
    for (const name of COMPANIONS) {
      const link = join(consumer, "node_modules", name)
      mkdirSync(dirname(link), { recursive: true })
      symlinkSync(join(PROJECT_ROOT, "node_modules", name), link)
    }
    return consumer
  })())

// Installed before the scenario's steps run: a hook is bounded only by the
// scenario's own 300 s, not by the 120 s each step gets, and a cold npm cache
// can take most of that.
Before("@tarball", async () => {
  await installedConsumer()
})

// One install serves every scenario: the repository gets the consumer's
// package.json and a symlink to its node_modules.
Given(
  "npm has installed gtd's packed tarball, beside typescript, vitest, quickpickle and @types\\/node linked from this checkout, into the test project's package.json and node_modules",
  async (world: GtdWorld) => {
    const consumer = await installedConsumer()
    copyFileSync(join(consumer, "package.json"), join(world.repoDir, "package.json"))
    symlinkSync(join(consumer, "node_modules"), join(world.repoDir, "node_modules"))
  },
)

// The install's own path, not the repository's symlink: a scenario may delete
// that to leave the config nothing but gtd to resolve `@pmelab/gtd/*` through.
Given(
  "every live gtd call, and the gtd on PATH, runs the installed bundle",
  async (world: GtdWorld) => {
    world.gtdBin = join(await installedConsumer(), "node_modules/@pmelab/gtd/dist/gtd.bundle.mjs")
    const shim = join(world.pathShimDir!, "gtd")
    writeFileSync(shim, `#!/usr/bin/env bash\nexec node "${world.gtdBin}" "$@"\n`)
    chmodSync(shim, 0o755)
  },
)

// From here on gtd runs through a script: `next` prints `document`, every other
// command is the real one — the loop it runs calls this script back each beat.
Given(
  "gtd runs through a script whose next command prints:",
  (world: GtdWorld, document: string) => {
    const dir = mkdtempSync(join(tmpdir(), "gtd-next-stub-"))
    world.closers.push(async () => rmSync(dir, { recursive: true, force: true }))
    const script = join(dir, "next-stub.mjs")
    writeFileSync(
      script,
      [
        `if (process.argv[2] === "next") process.stdout.write(${JSON.stringify(`${document}\n`)})`,
        `else await import(${JSON.stringify(pathToFileURL(world.gtdBin).href)})`,
        ``,
      ].join("\n"),
    )
    world.gtdBin = script
  },
)

When(
  "I run in the shell within {int} seconds:",
  async (world: GtdWorld, seconds: number, command: string) => {
    await world.runShell(String(command), seconds * 1000)
  },
)
