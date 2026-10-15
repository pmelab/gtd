import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { FLAGS, type FlagDeclaration } from "../src/flags/index.js"

export interface SourceFile {
  readonly path: string
  readonly text: string
}

export interface LintInput {
  readonly registry: readonly FlagDeclaration[]
  readonly files: readonly SourceFile[]
  readonly today: string
}

export interface LintResult {
  readonly code: 0 | 1 | 2
  readonly stderr: readonly string[]
}

const isRealDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const t = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(s)
}

/** Pure: argv is everything after the script path. */
export const lintFlags = (argv: readonly string[], input: LintInput): LintResult => {
  if (argv.length > 0) return { code: 2, stderr: ["usage: lint-flags takes no arguments"] }
  const stderr: string[] = []
  for (const { name, owner, expiry } of input.registry) {
    if (!isRealDate(expiry)) {
      stderr.push(`flag ${name} (owner ${owner}): expiry "${expiry}" is not a YYYY-MM-DD date`)
    } else if (expiry < input.today) {
      stderr.push(`flag ${name} (owner ${owner}) expired on ${expiry}`)
    }
  }
  const known = new Set(input.registry.map((f) => f.name.toUpperCase()))
  for (const { path, text } of input.files) {
    text.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(/GTD_FLAG_([A-Za-z0-9_]+)/g)) {
        if (!known.has(m[1]!)) {
          stderr.push(`${path}:${i + 1}: ${m[0]} names no registered flag`)
        }
      }
    })
  }
  return { code: stderr.length > 0 ? 1 : 0, stderr }
}

// Browser bundle (src/web/*.tsx) is scanned too; stories are not shipped.
export const shippedSources = (root: string): readonly SourceFile[] =>
  readdirSync(root, { recursive: true })
    .map((p) => join(root, String(p)))
    .filter((p) => /\.tsx?$/.test(p) && !/\.(test|fixture|stories)\.tsx?$/.test(p))
    .sort()
    .map((path) => ({ path, text: readFileSync(path, "utf8") }))

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { code, stderr } = lintFlags(process.argv.slice(2), {
    registry: FLAGS,
    files: shippedSources("src"),
    today: new Date().toISOString().slice(0, 10),
  })
  for (const line of stderr) process.stderr.write(`${line}\n`)
  process.exitCode = code
}
