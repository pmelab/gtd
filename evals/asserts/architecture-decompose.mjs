// `architecture.decompose`'s grader: the shared core (which already grades
// the count-and-shape rule — the expected package files, via `matchGtdFiles`'s
// descriptor branch — through `checkGtdFilesChanged`); `.gtd/ARCHITECTURE.md`
// must survive, so it may not appear among the changed files. On top, every
// test the architecture declares must be declared by a package: e2e ones by
// package 00, unit ones by any — four prose-only packages would otherwise pass.
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
  const { scenarioPackage, e2e, unit } = caseDef.expect[variant].declaredTests
  const files = result.packageFiles ?? {}
  const scenario = files[scenarioPackage]
  if (scenario === undefined)
    return fail(`no ${scenarioPackage} — package 00 writes the e2e scenarios`)
  const inScenario = declaredIn(scenario)
  const missingE2e = e2e.filter((path) => !inScenario.includes(`e2e: ${path}`))
  if (missingE2e.length > 0) {
    return fail(`${scenarioPackage} does not declare e2e: ${missingE2e.join(", ")}`)
  }
  const all = Object.values(files).flatMap(declaredIn)
  const missingUnit = unit.filter((path) => !all.includes(`unit: ${path}`))
  if (missingUnit.length > 0) {
    return fail(`no package declares unit: ${missingUnit.join(", ")}`)
  }
  return undefined
}

export default function grade(output, context) {
  return safeGrade(output, context, spec, [...SHARED_CHECKS, checkDeclaredTests])
}
