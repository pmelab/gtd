import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import type { RunTools } from "./flows/index.js"

/** A path the callback names, confined to the repository — a tool never reaches outside it. */
const inside = (root: string, path: string): string => {
  const absolute = resolve(root, path)
  const rel = relative(root, absolute)
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`gtd exec: "${path}" is not a path inside the repository`)
  }
  return absolute
}

/**
 * The tools a `run` callback acts through. Command output streams to
 * `commentary` (stderr) as well as coming back to the callback — the step's
 * outcome is the tree it leaves, never anything it prints.
 */
export const runTools = (
  root: string,
  env: Readonly<Record<string, string | undefined>>,
  commentary: (chunk: string) => void,
): RunTools => ({
  sh: (command) =>
    new Promise((done, fail) => {
      const child = spawn("sh", ["-c", command], {
        cwd: root,
        env: env as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
      })
      let output = ""
      const collect = (chunk: Buffer): void => {
        const text = chunk.toString("utf8")
        output += text
        commentary(text)
      }
      child.stdout.on("data", collect)
      child.stderr.on("data", collect)
      child.on("error", fail)
      child.on("close", (code) => done({ ok: code === 0, code: code ?? 1, output }))
    }),
  fs: {
    read: (path) => {
      const absolute = inside(root, path)
      return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined
    },
    write: (path, content) => {
      const absolute = inside(root, path)
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, content)
    },
    rm: (...paths) => {
      for (const path of paths) rmSync(inside(root, path), { recursive: true, force: true })
    },
    exists: (path) => existsSync(inside(root, path)),
  },
})
