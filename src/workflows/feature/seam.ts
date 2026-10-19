import { posix } from "node:path"
import {
  changes,
  check,
  env,
  head,
  human,
  judgeDiffShape,
  kept,
  quote,
  read,
  removeScript,
  run,
  scope,
  slice,
  vars,
  type Change,
  type DiffShapeResult,
  type KeptTip,
} from "../../flows/index.js"
import { healthy } from "../shared/health.js"
import { coder, FEEDBACK, REQUIREMENTS } from "../shared/steps.js"
import * as t from "../shared/text.js"
import { defaults } from "../shared/vars.js"
import { criteriaOf, requireCriteria, requireCriteriaFrozen } from "./criteria.js"
import {
  COMMENT,
  holdsCallSites,
  isTestFile,
  refactorStrays,
  reviewedRefactor,
} from "./refactor.js"
import { isCode } from "./review.js"
import { flagModeOn } from "../shared/options.js"
import type { RiskTier } from "./tier.js"

/** Naive-pass retries after a `reject` or a red suite; the next one rests at `seam.steer`. */
const NAIVE_RETRIES = 2

/** A change to an existing file outside the allowlist is a stray even when the task needs it: the judge decides. */
export const judgeSeam = (tip: KeptTip): Promise<DiffShapeResult> =>
  judgeDiffShape("judge", {
    changes: tip.changes,
    allow: (vars.seamAllow ?? defaults.seamAllow!)
      .split(",")
      .map((glob) => glob.trim())
      .filter((glob) => glob !== ""),
    exempt: tip.changes.filter((c) => c.status === "added").map((c) => c.path),
  })

export const naivePass = (retry?: t.NaiveRetry): Promise<void> =>
  t.agentWithSkills("naive", t.naivePassPrompt(retry), {
    label: retry === undefined ? "Writing the naive pass" : "Rewriting the naive pass",
    keep: true,
    model: coder(),
    system: t.builderSystem(),
  })

// Only a string an import, `require` or `mock` call takes: a URL route or path-like data is not one.
const IMPORTED = /(?:\bfrom|\bimport|\brequire\s*\(|\bmock\s*\()\s*\(?\s*(["'`])([^"'`\n]+)\1/g
const EXTENSION = /\.[\w-]+$/
const ALIAS = /^(?:[@~]\/|#)/

/** The specifiers an added `path` answers to: itself, without its extension, and its directory for an `index`. */
const namesOf = (path: string): string[] => {
  const bare = path.replace(EXTENSION, "")
  return posix.basename(bare) === "index" ? [path, bare, posix.dirname(bare)] : [path, bare]
}

/**
 * The repository paths `test` imports, each with and without an extension: a
 * relative specifier resolved from its directory, an aliased one (`@/`, `~/`,
 * `#`) as a path tail, anything else as written. Comments are skipped; a
 * computed import goes unseen.
 */
const importsOf = (test: Change): { readonly path: string; readonly tail: boolean }[] =>
  [...(test.after ?? "").replace(COMMENT, "").matchAll(IMPORTED)].flatMap(([, , spec]) => {
    const relative = /^\.\.?(\/|$)/.test(spec!)
    const tail = ALIAS.test(spec!)
    const path = relative ? posix.join(posix.dirname(test.path), spec!) : spec!.replace(ALIAS, "")
    return [path, path.replace(EXTENSION, "")].map((p) => ({ path: p, tail }))
  })

const reaches = (imports: ReturnType<typeof importsOf>, added: string): boolean =>
  namesOf(added).some((name) =>
    imports.some(({ path, tail }) => name === path || (tail && name.endsWith(`/${path}`))),
  )

const named = (id: string, text: string): boolean =>
  new RegExp(`(?<![\\w-])${id}(?!\\d)`).test(text)

/** The lines `change` added: an ID an earlier change left in the file does not count. */
const addedLines = (change: Change): string => {
  const before = new Set((change.before ?? "").split("\n"))
  return change
    .after!.split("\n")
    .filter((line) => !before.has(line))
    .join("\n")
}

/**
 * Why `tip`'s tests fall short, or `undefined`: a criterion ID of `file` no
 * test line of the pass names, or a test importing a file the pass added —
 * naive structure a reset and refactor replaces, which the tests must survive.
 */
export const acceptanceFault = (file: string, tip: KeptTip): string | undefined => {
  const ids = (criteriaOf(read(file) ?? "") ?? []).map((c) => c.id).filter((id) => id !== "")
  const tests = tip.changes.filter(
    (c) => c.after !== undefined && isCode(c.path) && isTestFile(c.path),
  )
  const lines = tests.map(addedLines)
  const untested = ids.filter((id) => !lines.some((text) => named(id, text)))
  if (untested.length > 0)
    return `acceptance-tests: no test of the naive pass names ${untested.join(", ")} — write a behaviour-level test for each criterion with its ID in the test or scenario name, e.g. "[${untested[0]}] …"`
  const added = tip.changes
    .filter((c) => c.status === "added" && isCode(c.path) && !isTestFile(c.path))
    .map((c) => c.path)
  const reaching = tests
    .filter((test) => holdsCallSites(test.path))
    .flatMap((test) => {
      const imports = importsOf(test)
      return added
        .filter((path) => reaches(imports, path))
        .map((path) => `  - ${test.path} → ${path}`)
    })
  if (reaching.length > 0)
    return `acceptance-internals: these tests import files the naive pass added — test through code that existed before it (a public entry point, an existing module's exports):\n${reaching.join("\n")}`
  return undefined
}

const restore = (path: string): string =>
  `if git cat-file -e ${quote(`HEAD:${path}`)} 2>/dev/null; then git checkout -q HEAD -- ${quote(path)}; else rm -f -- ${quote(path)}; fi`

/**
 * Run the suite with `tip`'s diff applied, then take it out again; resolves
 * `true` when green. The pass's paths go back to HEAD before (an interrupted
 * run left them applied) and after; afterwards so does anything else the run
 * changed, judged against what was already dirty, which is left alone.
 */
const naiveGreen = (tip: KeptTip): Promise<boolean> => {
  const paths = tip.changes.map((c) => restore(c.path))
  return check(
    "check",
    [
      ...paths,
      "dirty=$(git -c core.quotePath=false ls-files -m -d -o --exclude-standard)",
      `if ! git diff --binary ${quote(`${tip.hash}^`)} ${quote(tip.hash)} -- | git apply; then`,
      "  echo 'gtd: the kept naive pass no longer applies to HEAD; no test ran'",
      "  exit 1",
      "fi",
      "(",
      env.testCommand ?? "",
      ")",
      "code=$?",
      ...paths,
      "git -c core.quotePath=false ls-files -m -d -o --exclude-standard | while IFS= read -r path; do",
      '  printf \'%s\\n\' "$dirty" | grep -qxF -- "$path" && continue',
      '  if git cat-file -e "HEAD:$path" 2>/dev/null; then git checkout -q HEAD -- "$path"; else rm -f -- "$path"; fi',
      "done",
      'exit "$code"',
    ].join("\n"),
    { report: FEEDBACK, label: "Running the naive pass's tests" },
  )
}

export interface ImplementOptions {
  readonly reference?: string | undefined
  readonly tier?: RiskTier | undefined
  readonly amend?: boolean | undefined
  /** After a refactor slice, which may already carry the feature: an empty turn completes the step. */
  readonly afterRefactor?: boolean | undefined
}

export function implement(options?: ImplementOptions): Promise<void>
/** @deprecated Pass `implement({ reference, tier, amend })`. */
export function implement(
  reference: string | undefined,
  tier?: RiskTier,
  amend?: boolean,
): Promise<void>
export function implement(
  first?: string | ImplementOptions,
  tier?: RiskTier,
  amend?: boolean,
): Promise<void> {
  const options: ImplementOptions =
    typeof first === "object" && first !== null ? first : { reference: first, tier, amend }
  return scope("implement", async () => {
    await t.agentWithSkills(
      "building",
      t.implementBuildingPrompt(
        options.reference,
        options.tier,
        options.amend,
        options.afterRefactor,
        flagModeOn(),
      ),
      {
        label: "Implementing",
        model: coder(),
        system: t.builderSystem(),
        ...(options.afterRefactor === true ? { allowEmpty: true } : {}),
      },
    )
    requireCriteriaFrozen(REQUIREMENTS)
    await healthy(
      () =>
        t.agentWithSkills("fix.suite.fixing", t.implementFixPrompt(), {
          label: "Fixing the check",
          file: FEEDBACK,
          model: coder(),
          system: t.builderSystem(),
        }),
      { guard: () => requireCriteriaFrozen(REQUIREMENTS), guardRests: false },
    )
    await run("closing", removeScript([REQUIREMENTS]), { label: "Closing out the implementation" })
  })
}

interface Decision {
  readonly reference: string
  /** Present only on `refactor-first`: the refactor runs before the implementation. */
  readonly shape?: DiffShapeResult
}

/** Resolves `true` when the human steered (edited), `false` on a clean overrule. */
const steer = async (retry: t.NaiveRetry): Promise<boolean> => {
  await human("steer", {
    message: t.seamSteerMessage(retry),
    label: "Steer or overrule the naive pass",
    file: REQUIREMENTS,
    acceptClean: true,
  })
  if (changes().length === 0) return false
  requireCriteria(REQUIREMENTS)
  return true
}

type Verdict =
  | { readonly kind: "retry"; readonly retry: t.NaiveRetry }
  | { readonly kind: "steered" }
  | { readonly kind: "overruled" }

/** Rejects, test faults and red checks share one budget; a steer or an overrule refills it. */
const budget = (): ((next: t.NaiveRetry) => Promise<Verdict>) => {
  let retries = 0
  return async (next) => {
    if (retries < NAIVE_RETRIES) {
      retries++
      return { kind: "retry", retry: next }
    }
    const steered = await steer(next)
    retries = 0
    // A steered or overruled red pass leaves its report behind: nothing reads it any more.
    if (read(FEEDBACK) !== undefined)
      await run("clear", removeScript([FEEDBACK]), { label: "Clearing the red check" })
    return { kind: steered ? "steered" : "overruled" }
  }
}

interface Vetting {
  readonly again: ReturnType<typeof budget>
  /** Set once a human overrules a test fault: the rule does not fit this change, so later passes skip it. */
  waived: boolean
}

/** Sends a pass whose tests fall short or run red back (`undefined`: it goes on, an overruled one as it is). */
const vetted = async (tip: KeptTip, vetting: Vetting): Promise<Verdict | undefined> => {
  const fault = vetting.waived ? undefined : acceptanceFault(REQUIREMENTS, tip)
  if (fault !== undefined) {
    const verdict = await vetting.again({ fault, hash: tip.hash })
    if (verdict.kind !== "overruled") return verdict
    vetting.waived = true
  }
  if (await naiveGreen(tip)) return undefined
  const verdict = await vetting.again({ red: tip.hash })
  return verdict.kind === "overruled" ? undefined : verdict
}

/** The judge's ruling on a vetted pass: the decision, or the next attempt's verdict. */
const ruled = async (tip: KeptTip, again: Vetting["again"]): Promise<Decision | Verdict> => {
  const shape = await judgeSeam(tip)
  if (shape.choice === "land") return { reference: tip.hash }
  if (shape.choice === "refactor-first") return { reference: tip.hash, shape }
  const next = await again({ strays: shape.strays, p: shape.judgment?.answers.shape?.p ?? 0 })
  return next.kind === "overruled" ? { reference: tip.hash } : next
}

const decide = (): Promise<Decision> =>
  scope("seam", async () => {
    const vetting: Vetting = { again: budget(), waived: false }
    let retry: t.NaiveRetry | undefined
    for (;;) {
      await naivePass(retry)
      const tip = kept("naive")!
      const outcome = (await vetted(tip, vetting)) ?? (await ruled(tip, vetting.again))
      if (!("kind" in outcome)) return outcome
      retry = outcome.kind === "retry" ? outcome.retry : undefined
    }
  })

export interface SeamOutcome {
  /** The naive pass's kept tip: the first implement turn's reading material. */
  readonly reference: string
  /** The feature review's base: HEAD after the refactor on refactor-first, else the caller's base. */
  readonly base: string
  readonly refactored?: boolean
}

export const seamBuild = async (base: string): Promise<SeamOutcome> => {
  const { reference, shape } = await decide()
  if (shape === undefined) return { reference, base }
  if (shape.unreadable.length > 0) {
    await scope("seam", () =>
      human("by-hand", {
        message: t.seamByHandMessage(shape.strays, shape.unreadable, reference),
        label: "Reviewing unreadable files by hand",
        acceptClean: true,
      }),
    )
    return { reference, base }
  }
  if (refactorStrays(shape).length === 0) return { reference, base }
  const refactored = await slice("refactor", () => reviewedRefactor(shape, { reference }))
  return { reference, base: head(), refactored }
}
