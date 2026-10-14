// `architecture.decompose`'s grader: the shared core (which already grades
// the count-and-shape rule — the expected package files, via `matchGtdFiles`'s
// descriptor branch — through `checkGtdFilesChanged`); `.gtd/ARCHITECTURE.md`
// must survive, so it may not appear among the changed files. On top, every
// test the architecture declares must be declared by some package — prose-only
// packages would otherwise pass.
import { SHARED_CHECKS, safeGrade } from "./shared.mjs"
import spec from "../cases/architecture-decompose.mjs"

const fail = (reason) => ({ pass: false, score: 0, reason })

// Mirrors the workflow's own `## Tests` parser: one `- unit|e2e: \`path\`` per line.
const declaredIn = (text) => {
  const found = []
  let inTests = false
  for (const line of text.split("\n")) {
    if (/^##\s/.test(line)) inTests = /^##\s+Tests\s*$/.test(line)
    else if (inTests) {
      const match = /^\s*-\s+(unit|e2e):\s+`([^`]+)`/.exec(line)
      if (match) found.push(`${match[1]}: ${match[2]}`)
    }
  }
  return found
}

export function checkDeclaredTests(result, caseDef, variant) {
  const { e2e, unit } = caseDef.expect[variant].declaredTests
  const all = Object.values(result.packageFiles ?? {}).flatMap(declaredIn)
  const missing = [
    ...e2e.map((path) => `e2e: ${path}`),
    ...unit.map((path) => `unit: ${path}`),
  ].filter((entry) => !all.includes(entry))
  if (missing.length > 0) return fail(`no package declares ${missing.join(", ")}`)
  return undefined
}

export default function grade(output, context) {
  return safeGrade(output, context, spec, [...SHARED_CHECKS, checkDeclaredTests])
}
