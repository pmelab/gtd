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
  refuse,
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
import { isTestFile, refactorStrays, reviewedRefactor } from "./refactor.js"
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

const isCode = (path: string): boolean => path !== ".gtd" && !path.startsWith(".gtd/")

const QUOTED = /(["'`])([^"'`\n]+)\1/g
const EXTENSION = /\.[\w-]+$/

/** The specifiers an added `path` answers to: itself, without its extension, and its directory for an `index`. */
const namesOf = (path: string): string[] => {
  const bare = path.replace(EXTENSION, "")
  return posix.basename(bare) === "index" ? [path, bare, posix.dirname(bare)] : [path, bare]
}

/**
 * Whether `test` imports `added` — by a relative specifier resolved from its
 * own directory, or an aliased or root-relative one matching the path's end.
 * Text only: a dynamic or computed import goes unseen.
 */
const reaches = (test: Change, added: string): boolean => {
  const names = namesOf(added)
  return [...(test.after ?? "").matchAll(QUOTED)].some(([, , spec]) => {
    const relative = spec!.startsWith("./") || spec!.startsWith("../")
    if (!relative && !spec!.includes("/")) return false
    const path = relative
      ? posix.join(posix.dirname(test.path), spec!)
      : spec!.replace(/^[@~]\//, "").replace(/^\//, "")
    return [path, path.replace(EXTENSION, "")].some((candidate) =>
      names.some((name) =>
        relative ? name === candidate : name === candidate || name.endsWith(`/${candidate}`),
      ),
    )
  })
}

const named = (id: string, text: string): boolean =>
  new RegExp(`(?<![\\w-])${id}(?!\\d)`).test(text)

/**
 * Refuse a naive pass whose tests leave a criterion ID of `file` unnamed, or
 * import a file the pass added: that is naive structure a reset and refactor
 * replaces, and the tests must survive it.
 */
export const requireAcceptanceTests = (file: string, tip: KeptTip): void => {
  const ids = (criteriaOf(read(file) ?? "") ?? []).map((c) => c.id).filter((id) => id !== "")
  const tests = tip.changes.filter(
    (c) => c.after !== undefined && isCode(c.path) && isTestFile(c.path),
  )
  const untested = ids.filter((id) => !tests.some((c) => named(id, c.after!)))
  if (untested.length > 0)
    refuse(
      `gtd land: acceptance-tests: no test of the naive pass names ${untested.join(", ")} — write a behaviour-level test for each criterion with its ID in the test or scenario name, e.g. "[${untested[0]}] …"`,
    )
  const added = tip.changes
    .filter((c) => c.status === "added" && isCode(c.path) && !isTestFile(c.path))
    .map((c) => c.path)
  // A `.feature` or a snapshot names paths as data, never as an import.
  const reaching = tests
    .filter((test) => !test.path.endsWith(".feature") && !test.path.endsWith(".snap"))
    .flatMap((test) =>
      added.filter((path) => reaches(test, path)).map((path) => `  - ${test.path} → ${path}`),
    )
  if (reaching.length > 0)
    refuse(
      `gtd land: acceptance-internals: these tests import files the naive pass added — test through code that existed before it (a public entry point, an existing module's exports):\n${reaching.join("\n")}`,
    )
}

/** Run the suite with `tip`'s diff applied, then take it out again; resolves `true` when green. */
const naiveGreen = (tip: KeptTip): Promise<boolean> => {
  const range = `${quote(`${tip.hash}^`)} ${quote(tip.hash)}`
  return check(
    "check",
    [
      `git diff --binary ${range} -- | git apply || exit $?`,
      `(${env.testCommand ?? ""})`,
      "code=$?",
      `git diff --binary ${range} -- | git apply -R`,
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

const decide = (): Promise<Decision> =>
  scope("seam", async () => {
    let retry: t.NaiveRetry | undefined
    let retries = 0
    // Any steer edit restarts with a fresh budget and no stale retry; a clean landing overrules.
    const again = async (next: t.NaiveRetry): Promise<"again" | "overrule"> => {
      retry = next
      if (retries < NAIVE_RETRIES) {
        retries++
        return "again"
      }
      if (!(await steer(next))) return "overrule"
      retry = undefined
      retries = 0
      return "again"
    }
    for (;;) {
      await naivePass(retry)
      const tip = kept("naive")!
      requireAcceptanceTests(REQUIREMENTS, tip)
      // An overruled red pass goes on to the judge as it is.
      if (!(await naiveGreen(tip)) && (await again({ red: tip.hash })) === "again") continue
      const shape = await judgeSeam(tip)
      if (shape.choice === "land") return { reference: tip.hash }
      if (shape.choice === "refactor-first") {
        return { reference: tip.hash, shape }
      }
      const rejection = { strays: shape.strays, p: shape.judgment?.answers.shape?.p ?? 0 }
      if ((await again(rejection)) === "overrule") return { reference: tip.hash }
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
