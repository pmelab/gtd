import { posix } from "node:path"
import {
  agent,
  applyScript,
  changes,
  changesSince,
  check,
  codeChanges,
  env,
  head,
  human,
  judgeDiffShape,
  kept,
  quote,
  read,
  refuse,
  removeScript,
  restoreScript,
  run,
  scope,
  vars,
  wrote,
  type Change,
  type DiffShapeResult,
  type KeptTip,
} from "../../flows/index.js"
import { coder, FEEDBACK, NAIVE_TEST, REFACTOR_NOTE, REQUIREMENTS } from "../shared/steps.js"
import * as t from "../shared/text.js"
import { defaults } from "../shared/vars.js"
import { green } from "./green.js"
import { criterionIds, requireCriteria, requireCriteriaFrozen } from "./criteria.js"
import {
  COMMENT,
  holdsCallSites,
  isTestFile,
  refactorStrays,
  reviewedRefactor,
} from "./refactor.js"
import { isCode } from "../shared/review.js"
import { flagModeOn, naiveTestOn } from "../shared/options.js"
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

export const naivePass = (retry?: t.NaiveRetry | t.NaiveTested): Promise<void> =>
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

const acceptanceTests = (changes: readonly Change[]): readonly Change[] =>
  changes.filter((c) => c.after !== undefined && isCode(c.path) && isTestFile(c.path))

/**
 * Why `tip`'s tests fall short, or `undefined`: a test importing a file the
 * pass added — naive structure a reset and refactor replaces, which the tests
 * must survive.
 */
export const acceptanceFault = (tip: KeptTip): string | undefined => {
  const added = tip.changes
    .filter((c) => c.status === "added" && isCode(c.path) && !isTestFile(c.path))
    .map((c) => c.path)
  const reaching = acceptanceTests(tip.changes)
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

/** What a rebuild carries over from the naive pass `tip`: every test file it added or changed. */
export const naiveAcceptance = (tip: KeptTip): t.Acceptance => ({
  hash: tip.hash,
  tests: acceptanceTests(tip.changes).map((c) => c.path),
})

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
      `if ! git diff --binary --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ ${quote(`${tip.hash}^`)} ${quote(tip.hash)} -- | git apply --whitespace=nowarn; then`,
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

export type { Acceptance, Rebuild } from "../shared/text.js"

export interface ImplementOptions {
  readonly reference?: string | undefined
  readonly tier?: RiskTier | undefined
  readonly amend?: boolean | undefined
  /** After a refactor, which may already carry the feature: an empty turn completes the step. */
  readonly afterRefactor?: boolean | undefined
  /** A kept naive tip to apply as the implementation; built fresh only when it no longer applies. */
  readonly naive?: string | undefined
  /** A rebuild after a refactor-first judgment: the note it plugs into, the acceptance tests it must carry. */
  readonly rebuild?: t.Rebuild | undefined
  /** @deprecated Ignored since the coverage judge is gone. */
  readonly base?: string | undefined
}

/** Resolves `false` when the tip no longer applies (the failure is in `.gtd/FEEDBACK.md`) or has nothing outside `.gtd/` to apply. */
const applied = async (tip: string): Promise<boolean> => {
  await run("applying", applyScript(tip, FEEDBACK, t.naiveApplyFailure(tip), [".gtd"]), {
    label: "Applying the naive pass",
  })
  return !wrote(FEEDBACK) && codeChanges().length > 0
}

const build = async (options: ImplementOptions): Promise<void> => {
  await t.agentWithSkills(
    "building",
    t.implementBuildingPrompt(
      options.reference,
      options.tier,
      options.amend,
      options.afterRefactor,
      flagModeOn(),
      options.rebuild,
    ),
    {
      label: "Implementing",
      model: coder(),
      system: t.builderSystem(),
      ...(options.afterRefactor === true ? { allowEmpty: true } : {}),
    },
  )
  requireCriteriaFrozen(REQUIREMENTS)
}

export function implement(options?: ImplementOptions): Promise<void>
/** @deprecated Pass `implement({ reference, tier, amend })`. */
export function implement(
  reference: string | undefined,
  tier?: RiskTier,
  amend?: boolean,
): Promise<void>
export async function implement(
  first?: string | ImplementOptions,
  tier?: RiskTier,
  amend?: boolean,
): Promise<void> {
  await implementing(
    typeof first === "object" && first !== null ? first : { reference: first, tier, amend },
  )
}

/** `implement`, resolving with the criterion IDs the requirements listed when it closed. */
export const implementing = (options: ImplementOptions): Promise<readonly string[]> =>
  scope("implement", async () => {
    const built = options.naive === undefined || !(await applied(options.naive))
    if (built) await build(options)
    else requireCriteriaFrozen(REQUIREMENTS)
    await green()
    const ids = criterionIds(read(REQUIREMENTS) ?? "")
    await run("closing", removeScript([REQUIREMENTS, REFACTOR_NOTE]), {
      label: "Closing out the implementation",
    })
    return ids
  })

interface Decision {
  readonly reference: string
  readonly tip: KeptTip
  /** Absent on `land` (or with `flagMode` off, unjudged): the pass itself is the implementation. */
  readonly shape?: DiffShapeResult
}

/** Resolves `true` when the human steered (edited), `false` on a clean overrule. */
const steer = async (retry: t.NaiveRetry): Promise<boolean> => {
  await human("steer", {
    message: t.seamSteerMessage(retry, flagModeOn()),
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
  again: ReturnType<typeof budget>
  /** Set once a human overrules a test fault: the rule does not fit this change, so later passes skip it. */
  waived: boolean
}

/** Sends a pass whose tests fall short or run red back (`undefined`: it goes on, an overruled one as it is). */
const vetted = async (tip: KeptTip, vetting: Vetting): Promise<Verdict | undefined> => {
  const fault = vetting.waived ? undefined : acceptanceFault(tip)
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
  if (shape.choice === "land") return { reference: tip.hash, tip }
  if (shape.choice === "refactor-first") return { reference: tip.hash, tip, shape }
  const next = await again({ strays: shape.strays, p: shape.judgment?.answers.shape?.p ?? 0 })
  return next.kind === "overruled" ? { reference: tip.hash, tip } : next
}

/** Back to `before`: every code path, and the notes file. `.gtd/` edits (the requirements) stay. */
const untryScript = (before: string): string => {
  const code = changesSince(before).filter((c) => isCode(c.path))
  return restoreScript(
    head(),
    {
      restore: code.filter((c) => c.status !== "added").map((c) => c.path),
      remove: [...code.filter((c) => c.status === "added").map((c) => c.path), NAIVE_TEST],
    },
    before,
  )
}

/**
 * A person tries the green pass `tip` in the working tree. Resolves
 * `undefined` on a clean landing (signed off), else what they sent back;
 * either way the pass, their code edits and the notes file leave the tree.
 */
const tried = async (tip: KeptTip): Promise<t.NaiveTested | undefined> => {
  const before = head()
  await run("applying", applyScript(tip.hash, FEEDBACK, t.naiveApplyFailure(tip.hash), [".gtd"]), {
    label: "Applying the naive pass to try it",
  })
  await human("try", {
    message: t.naiveTryMessage(flagModeOn()),
    label: "Try the naive pass",
    file: NAIVE_TEST,
    acceptClean: true,
  })
  const landed = changes()
  const edits = landed.some((c) => isCode(c.path)) ? head() : undefined
  const notes = read(NAIVE_TEST)?.trim() || undefined
  if (landed.some((c) => c.path === REQUIREMENTS)) requireCriteria(REQUIREMENTS)
  await run("restoring", untryScript(before), { label: "Taking the naive pass out again" })
  return landed.length === 0 ? undefined : { tested: tip.hash, notes, edits }
}

const decide = (): Promise<Decision> =>
  scope("seam", async () => {
    const vetting: Vetting = { again: budget(), waived: false }
    let retry: t.NaiveRetry | t.NaiveTested | undefined
    for (;;) {
      await naivePass(retry)
      const tip = kept("naive")!
      const verdict = await vetted(tip, vetting)
      if (verdict === undefined && naiveTestOn()) {
        const sentBack = await tried(tip)
        if (sentBack !== undefined) {
          // A person's feedback is no failed attempt: the next pass gets a full retry budget.
          vetting.again = budget()
          retry = sentBack
          continue
        }
      }
      const outcome =
        verdict ?? (flagModeOn() ? await ruled(tip, vetting.again) : { reference: tip.hash, tip })
      if (!("kind" in outcome)) return outcome
      retry = outcome.kind === "retry" ? outcome.retry : undefined
    }
  })

export interface SeamOutcome {
  /** The naive pass's kept tip: applied as the implementation when `land`, else the first implement turn's reading material. */
  readonly reference: string
  /** The naive pass lands as it is: no build turn. */
  readonly land?: boolean
  /** The feature's base: HEAD after the refactor on refactor-first, else the caller's base. */
  readonly base: string
  readonly refactored?: boolean
  /** Set on refactor-first: what the rebuild carries over from the naive pass (the note only after a refactor). */
  readonly rebuild?: t.Rebuild
}

/** Write the refactor note from the whole naive pass; a turn that changes anything else is refused. */
export const refactorNote = async (
  reference: string,
  strays: readonly string[],
): Promise<string> => {
  await agent("note", t.refactorNotePrompt(reference, strays), {
    label: "Writing the refactor note",
    file: REFACTOR_NOTE,
    model: coder(),
    system: t.builderSystem(),
  })
  const others = changes()
    .map((c) => c.path)
    .filter((path) => path !== REFACTOR_NOTE)
  const note = read(REFACTOR_NOTE) ?? ""
  if (others.length > 0 || note.trim() === "")
    refuse(
      `gtd land: refactor-note: write ${REFACTOR_NOTE} and change nothing else${others.length > 0 ? ` — revert these:\n${others.map((path) => `  - ${path}`).join("\n")}` : ""}`,
    )
  return note
}

export const seamBuild = async (base: string): Promise<SeamOutcome> => {
  const { reference, tip, shape } = await decide()
  if (shape === undefined) return { reference, base, land: true }
  if (shape.unreadable.length > 0) {
    await scope("seam", () =>
      human("by-hand", {
        message: t.seamByHandMessage(shape.strays, shape.unreadable, reference),
        label: "Reviewing unreadable files by hand",
        acceptClean: true,
      }),
    )
    return { reference, base, rebuild: { acceptance: naiveAcceptance(tip) } }
  }
  const strays = refactorStrays(shape)
  if (strays.length === 0) return { reference, base, rebuild: { acceptance: naiveAcceptance(tip) } }
  const note = await scope("seam", () => refactorNote(reference, strays))
  const refactored = await reviewedRefactor(shape, { reference, note })
  return {
    reference,
    base: head(),
    refactored,
    // Fixed at `seam.note`, like the package's scope: a later edit of the file reaches neither turn.
    rebuild: { note, acceptance: naiveAcceptance(tip) },
  }
}
