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
  run,
  scope,
  slice as sliced,
  vars,
  wrote,
  type Change,
  type DiffShapeResult,
  type KeptTip,
} from "../../flows/index.js"
import { coder, FEEDBACK, REFACTOR_NOTE, REQUIREMENTS, SLICES } from "../shared/steps.js"
import * as t from "../shared/text.js"
import { defaults } from "../shared/vars.js"
import { green, requireCoverage } from "./coverage.js"
import { criterionIds, requireCriteria, requireCriteriaFrozen } from "./criteria.js"
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

export const naivePass = (retry?: t.NaiveRetry, slice?: readonly string[]): Promise<void> =>
  t.agentWithSkills("naive", t.naivePassPrompt(retry, slice), {
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

const acceptanceTests = (changes: readonly Change[]): readonly Change[] =>
  changes.filter((c) => c.after !== undefined && isCode(c.path) && isTestFile(c.path))

const idsOf = (file: string, slice?: readonly string[]): string[] =>
  criterionIds(read(file) ?? "", slice)

// One rule for both gates, so a naive test carried over verbatim always satisfies the rebuild's.
const unnamed = (ids: readonly string[], tests: readonly Change[]): string[] => {
  const lines = tests.map(addedLines)
  return ids.filter((id) => !lines.some((text) => named(id, text)))
}

/**
 * Why `tip`'s tests fall short, or `undefined`: a criterion ID of `file` no
 * test line of the pass names, or a test importing a file the pass added —
 * naive structure a reset and refactor replaces, which the tests must survive.
 */
export const acceptanceFault = (
  file: string,
  tip: KeptTip,
  slice?: readonly string[],
): string | undefined => {
  const tests = acceptanceTests(tip.changes)
  const untested = unnamed(idsOf(file, slice), tests)
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

/** What a rebuild carries over from the naive pass `tip`: the IDs its tests name, and those test files. */
export const naiveAcceptance = (tip: KeptTip, slice?: readonly string[]): t.Acceptance => {
  const ids = idsOf(REQUIREMENTS, slice)
  const perTest = acceptanceTests(tip.changes).map((c) => {
    const lines = addedLines(c)
    return { path: c.path, ids: ids.filter((id) => named(id, lines)) }
  })
  return {
    hash: tip.hash,
    tests: perTest.filter((c) => c.ids.length > 0).map((c) => c.path),
    ids: ids.filter((id) => perTest.some((c) => c.ids.includes(id))),
  }
}

/**
 * Refuse a rebuild whose test changes since `since` leave out an ID the naive
 * pass's tests named. A skipped test still counts: the gate reads text, never runs it.
 */
export const requireAcceptance = (acceptance: t.Acceptance, since: string): void => {
  const missing = unnamed(acceptance.ids, acceptanceTests(changesSince(since)))
  if (missing.length === 0) return
  refuse(
    `gtd land: rebuild-acceptance: the rebuild's tests leave out ${missing.join(", ")} — carry over the naive pass's acceptance tests (\`git show ${acceptance.hash} -- ${acceptance.tests.map(quote).join(" ")}\`), each with its ID in the test or scenario name`,
  )
}

/**
 * Refuse a fix turn that, on its own, drops an ID the naive pass's tests named
 * from a test file. Turn-local, so a person's edit at an escalation rest never
 * wedges later fix turns.
 */
export const requireAcceptanceKept = (acceptance: t.Acceptance): void => {
  const dropped = acceptance.ids.filter((id) =>
    changes()
      .filter((c) => isCode(c.path) && isTestFile(c.path))
      .some((c) => named(id, c.before ?? "") && !named(id, c.after ?? "")),
  )
  if (dropped.length === 0) return
  refuse(
    `gtd land: rebuild-acceptance: this turn drops ${dropped.join(", ")} from the tests — the naive pass's acceptance tests stay; fix the code, not them`,
  )
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
  /** After a refactor slice, which may already carry the feature: an empty turn completes the step. */
  readonly afterRefactor?: boolean | undefined
  /** A kept naive tip to apply as the implementation; built fresh only when it no longer applies. */
  readonly naive?: string | undefined
  /** A rebuild after a refactor-first judgment: the note it plugs into, the acceptance tests it must carry. */
  readonly rebuild?: t.Rebuild | undefined
  /** The criterion IDs this slice builds, when the change has more than one slice. */
  readonly slice?: readonly string[] | undefined
  /** Where the slice began: the coverage judge reads only the tests changed since. */
  readonly base?: string | undefined
  /** Not the last slice: `.gtd/REQUIREMENTS.md` and `.gtd/SLICES.md` stay for the next one. */
  readonly more?: boolean | undefined
}

/** Resolves `false` when the tip no longer applies (the failure is in `.gtd/FEEDBACK.md`) or has nothing outside `.gtd/` to apply. */
const applied = async (tip: string): Promise<boolean> => {
  await run("applying", applyScript(tip, FEEDBACK, t.naiveApplyFailure(tip), [".gtd"]), {
    label: "Applying the naive pass",
  })
  return !wrote(FEEDBACK) && codeChanges().length > 0
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
    const since = head()
    const acceptance = options.rebuild?.acceptance
    const built = options.naive === undefined || !(await applied(options.naive))
    if (built)
      await t.agentWithSkills(
        "building",
        t.implementBuildingPrompt(
          options.reference,
          options.tier,
          options.amend,
          options.afterRefactor,
          flagModeOn(),
          options.rebuild,
          options.slice,
        ),
        {
          label: "Implementing",
          model: coder(),
          system: t.builderSystem(),
          ...(options.afterRefactor === true ? { allowEmpty: true } : {}),
        },
      )
    requireCriteriaFrozen(REQUIREMENTS)
    if (built && acceptance !== undefined) requireAcceptance(acceptance, since)
    // Fix turns are held to the carried tests too: deleting a red one must not buy a green suite.
    await green(
      built && acceptance !== undefined ? () => requireAcceptanceKept(acceptance) : undefined,
    )
    await requireCoverage(options.base, options.slice)
    await closing(options.more === true)
  })
}

/** A slice with `more` after it keeps the criteria and the slicing for the next one. */
const closing = (more: boolean): Promise<void> =>
  run("closing", removeScript(more ? [REFACTOR_NOTE] : [REQUIREMENTS, REFACTOR_NOTE, SLICES]), {
    label: "Closing out the implementation",
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
  readonly again: ReturnType<typeof budget>
  /** Set once a human overrules a test fault: the rule does not fit this change, so later passes skip it. */
  waived: boolean
}

/** Sends a pass whose tests fall short or run red back (`undefined`: it goes on, an overruled one as it is). */
const vetted = async (
  tip: KeptTip,
  vetting: Vetting,
  slice: readonly string[] | undefined,
): Promise<Verdict | undefined> => {
  const fault = vetting.waived ? undefined : acceptanceFault(REQUIREMENTS, tip, slice)
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

const decide = (slice: readonly string[] | undefined): Promise<Decision> =>
  scope("seam", async () => {
    const vetting: Vetting = { again: budget(), waived: false }
    let retry: t.NaiveRetry | undefined
    for (;;) {
      await naivePass(retry, slice)
      const tip = kept("naive")!
      const outcome =
        (await vetted(tip, vetting, slice)) ??
        (flagModeOn() ? await ruled(tip, vetting.again) : { reference: tip.hash, tip })
      if (!("kind" in outcome)) return outcome
      retry = outcome.kind === "retry" ? outcome.retry : undefined
    }
  })

export interface SeamOutcome {
  /** The naive pass's kept tip: applied as the implementation when `land`, else the first implement turn's reading material. */
  readonly reference: string
  /** The naive pass lands as it is: no build turn. */
  readonly land?: boolean
  /** The feature slice's base: HEAD after the refactor on refactor-first, else the caller's base. */
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

export interface SeamSlice {
  /** The criterion IDs the slice builds; absent for a change built in one slice. */
  readonly ids?: readonly string[] | undefined
  /** The refactor slice's name. */
  readonly refactor?: string | undefined
}

export const seamBuild = async (base: string, slice: SeamSlice = {}): Promise<SeamOutcome> => {
  const { reference, tip, shape } = await decide(slice.ids)
  if (shape === undefined) return { reference, base, land: true }
  if (shape.unreadable.length > 0) {
    await scope("seam", () =>
      human("by-hand", {
        message: t.seamByHandMessage(shape.strays, shape.unreadable, reference),
        label: "Reviewing unreadable files by hand",
        acceptClean: true,
      }),
    )
    return { reference, base, rebuild: { acceptance: naiveAcceptance(tip, slice.ids) } }
  }
  const strays = refactorStrays(shape)
  if (strays.length === 0)
    return { reference, base, rebuild: { acceptance: naiveAcceptance(tip, slice.ids) } }
  const note = await scope("seam", () => refactorNote(reference, strays))
  const refactored = await sliced(slice.refactor ?? "refactor", () =>
    reviewedRefactor(shape, { reference, note }),
  )
  return {
    reference,
    base: head(),
    refactored,
    // Fixed at `seam.note`, like the package's scope: a later edit of the file reaches neither turn.
    rebuild: { note, acceptance: naiveAcceptance(tip, slice.ids) },
  }
}
