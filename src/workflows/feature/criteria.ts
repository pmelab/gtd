import {
  answered,
  changes,
  head,
  judge,
  read,
  refuse,
  requireProgress,
  run,
  scope,
  type Change,
} from "../../flows/index.js"
import { HEADING, ITEM, markFenced } from "../shared/fences.js"
import { planner, REQUIREMENTS } from "../shared/steps.js"
import * as t from "../shared/text.js"

export interface Criterion {
  readonly id: string
  readonly text: string
  /** Tagged `(no hands-on)`: its tests prove it, so the hands-on test skips it. */
  readonly noHandsOn?: true
}

/** Acceptance criteria the human's sketch stated outright, ready to normalise. */
export interface StatedCriteria {
  readonly path: string
  readonly commit: string
  /** The file as the sketch left it: `unwind` reverts it out of the tree. */
  readonly text: string
  readonly criteria: readonly Criterion[]
}

/** Below this the judge's `yes` is not trusted: a wrong skip builds against criteria nobody can check. */
const CLEAR_MIN_P = 0.8

const ID = /^(AC-\d+)(\s*\(no hands-on\))?:\s*(.*)$/

const criterion = (id: RegExpExecArray, as = id[1]!): Criterion => ({
  id: as,
  text: id[3]!,
  ...(id[2] === undefined ? {} : { noHandsOn: true }),
})

/** The list items under the first heading `title` matches (at `level` when given), up to the next heading; wrapped lines joined, fenced lines ignored. */
const listUnder = (text: string, title: RegExp, level?: number): string[] | undefined => {
  const lines = markFenced(text)
  const at = lines.findIndex((l) => {
    const heading = l.fenced ? null : HEADING.exec(l.line)
    return (
      heading !== null &&
      (level === undefined || heading[1]!.length === level) &&
      title.test(heading[2]!)
    )
  })
  if (at === -1) return undefined
  const items: string[] = []
  let open = false
  for (const { line, fenced } of lines.slice(at + 1)) {
    if (fenced) {
      open = false
      continue
    }
    if (HEADING.test(line)) break
    const item = ITEM.exec(line)
    if (item !== null) {
      items.push(item[1]!.trim())
      open = true
    } else if (open && line.trim() !== "") {
      items[items.length - 1] = `${items.at(-1)!} ${line.trim()}`.trim()
    } else open = false
  }
  return items
}

/** The `- AC-<n>: …` list of `## Acceptance Criteria`, or `undefined` when the section is missing. */
export const criteriaOf = (text: string): readonly Criterion[] | undefined =>
  listUnder(text, /^acceptance criteria$/i, 2)?.map((item) => {
    const id = ID.exec(item)
    return id === null ? { id: "", text: item } : criterion(id)
  })

/**
 * Which criteria one slice builds, resolved against the file whenever read:
 * `only` drops an ID a steer deleted, `except` (the last slice) takes one a
 * steer added.
 */
export interface CriteriaSlice {
  readonly only?: readonly string[]
  readonly except?: readonly string[]
}

/** The ID'd criteria of `text`, only `slice`'s when given. */
export const criterionIds = (text: string, slice?: CriteriaSlice): string[] =>
  (criteriaOf(text) ?? [])
    .map((c) => c.id)
    .filter(
      (id) =>
        id !== "" &&
        (slice?.only === undefined || slice.only.includes(id)) &&
        !(slice?.except ?? []).includes(id),
    )

/** The ID'd criteria of `text` (`slice`'s when given) a person can try by hand: none tagged `(no hands-on)`. */
export const handsOnIds = (text: string, slice?: CriteriaSlice): string[] => {
  const tagged = (criteriaOf(text) ?? []).filter((c) => c.noHandsOn).map((c) => c.id)
  return criterionIds(text, slice).filter((id) => !tagged.includes(id))
}

/** `slice`'s IDs in `.gtd/REQUIREMENTS.md` as it is now; `undefined` for an unsliced change. */
export const sliceIds = (slice: CriteriaSlice | undefined): string[] | undefined =>
  slice === undefined ? undefined : criterionIds(read(REQUIREMENTS) ?? "", slice)

/** Items numbered `AC-1`…, unless every one already carries its own distinct ID. */
const numbered = (items: readonly string[]): Criterion[] => {
  const ids = items.map((item) => ID.exec(item))
  const own = ids.every((id) => id !== null) && new Set(ids.map((id) => id![1])).size === ids.length
  return items.map((item, i) => {
    const id = ids[i]
    if (own) return criterion(id!)
    return id === null ? { id: `AC-${i + 1}`, text: item } : criterion(id!, `AC-${i + 1}`)
  })
}

const STATED = /^acceptance criteria:?$/i

const statedItems = (text: string | undefined): string[] =>
  text === undefined ? [] : (listUnder(text, STATED) ?? []).filter((item) => item !== "")

/**
 * The criteria a `TODO.md` in the sketch `sketch` (the idle turn's changes)
 * added or changed under an `Acceptance criteria` heading. More than one such
 * file is ambiguous, and any other change in the sketch is input only triage
 * folds in, so none.
 */
export const statedCriteria = (
  sketch: readonly Change[],
  commit: string,
): StatedCriteria | undefined => {
  const found = sketch.flatMap((change) => {
    if (!/(^|\/)TODO\.md$/.test(change.path) || change.after === undefined) return []
    const items = statedItems(change.after)
    if (items.length === 0 || items.join("\n") === statedItems(change.before).join("\n")) return []
    return [{ path: change.path, commit, text: change.after, criteria: numbered(items) }]
  })
  return found.length === 1 && sketch.length === 1 ? found[0] : undefined
}

const listing = (criteria: readonly Criterion[]): string => criteria.map(t.criterionLine).join("\n")

/** Refuse a turn that leaves `file` without ID'd acceptance criteria. A deleted file is `requireProgress`'s call. */
export const requireCriteria = (file: string): void => {
  const text = read(file)
  if (text === undefined) return
  const criteria = criteriaOf(text) ?? []
  const unnamed = criteria.filter((c) => c.id === "")
  const ids = criteria.map((c) => c.id).filter((id) => id !== "")
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (criteria.length > 0 && unnamed.length === 0 && twice.length === 0) return
  const why =
    criteria.length === 0
      ? `no "## Acceptance Criteria" list`
      : unnamed.length > 0
        ? `${unnamed.length} criterion without an ID:\n${unnamed.map((c) => `  - ${c.text}`).join("\n")}`
        : `duplicate IDs: ${[...new Set(twice)].join(", ")}`
  refuse(
    `gtd land: acceptance-criteria: ${file} has ${why} — list every criterion under "## Acceptance Criteria" as "- AC-<n>: <checkable criterion>", each ID unique and never reused`,
  )
}

const isImpactHeading = (h: RegExpExecArray | null): boolean =>
  h !== null && h[1]!.length === 2 && /^impact$/i.test(h[2]!.trim())

/** Whether `text` has an unfenced, level-2 `## Impact` heading. */
export const hasImpact = (text: string): boolean =>
  markFenced(text).some((l) => !l.fenced && isImpactHeading(HEADING.exec(l.line)))

/** `text` without its `## Impact` section, whitespace collapsed. */
const withoutImpact = (text: string): string => {
  let inImpact = false
  const kept = markFenced(text).filter((l) => {
    const h = l.fenced ? null : HEADING.exec(l.line)
    if (h !== null && h[1]!.length <= 2) inImpact = isImpactHeading(h)
    return !inImpact
  })
  return kept
    .map((l) => l.line)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Refuse a turn that leaves `file` without a `## Impact` section. Only the
 * pending turn (`head()` is `""`): a triage lap recorded before Impact existed
 * replays without one, and refusing there would fail every in-flight process.
 * A human's edit at a later gate is not checked — the human owns that file then.
 */
export const requireImpact = (file: string): void => {
  if (head() !== "") return
  const text = read(file)
  if (text === undefined) return
  if (hasImpact(text)) return
  refuse(
    `gtd land: impact: ${file} has no "## Impact" section — explore the codebase and add "## Impact" naming the units, public surfaces and surprises this change touches`,
  )
}

/** Refuse a turn that changed `file` beyond its `## Impact` section. */
export const requireImpactOnly = (file: string): void => {
  const change = changes().get(file)
  if (change === undefined) return
  if (withoutImpact(change.before ?? "") === withoutImpact(change.after ?? "")) return
  refuse(
    `gtd land: impact-only: this turn may only add "## Impact" to ${file} — restore everything else`,
  )
}

/** The IDs a review's feedback lap must respect. */
export interface StableIds {
  /** Listed when the build closed: each may stay, reworded or not, or go. */
  readonly closed: readonly string[]
  /** Every ID handed out so far: any other is numbered above all of them. */
  readonly used: readonly string[]
}

const idNumber = (id: string): number => Number(id.slice("AC-".length))

/** Why `listed` renumbers or reuses an earlier ID; `undefined` when it does neither. */
export const unstableIds = (listed: readonly string[], ids: StableIds): string | undefined => {
  const top = Math.max(0, ...ids.used.map(idNumber))
  const reused = listed.filter((id) => !ids.closed.includes(id) && idNumber(id) <= top)
  if (reused.length === 0) return undefined
  return `numbers ${reused.join(", ")} at or below AC-${top}, an ID already handed out — keep a built criterion's ID (reword it in place when the review changes it), and number new ones from AC-${top + 1}`
}

/** Refuse criteria in `file` that renumber or reuse an earlier ID. */
export const requireStableIds = (file: string, ids: StableIds): void => {
  const why = unstableIds(criterionIds(read(file) ?? ""), ids)
  if (why !== undefined) refuse(`gtd land: criteria-ids: ${file} ${why}`)
}

/** Refuse a turn that changed the acceptance criteria in `file`: after the design gate only another design lap may. */
export const requireCriteriaFrozen = (file: string): void => {
  const change = changes().get(file)
  if (change === undefined) return
  const before = listing(criteriaOf(change.before ?? "") ?? [])
  if (before === listing(criteriaOf(change.after ?? "") ?? [])) return
  refuse(
    `gtd land: criteria-frozen: the acceptance criteria in ${file} are settled — restore them; only a design lap changes them`,
  )
}

/** Whether the judge trusts `stated` as clear and checkable, every criterion of it. Truncated evidence never is. */
const clear = async (stated: StatedCriteria): Promise<boolean> => {
  const { answers, truncated } = await judge("clear", {
    questions: [t.clearCriteriaQuestion],
    evidence: { criteria: listing(stated.criteria), sketch: stated.text },
    message: t.clearCriteriaMessage(),
    label: "Judging the stated acceptance criteria",
  })
  return truncated.length === 0 && answered(answers.clear, "yes", CLEAR_MIN_P)
}

/** The fast path's impact-only turn: add `## Impact`, leave the criteria alone. */
const impact = async (): Promise<void> => {
  await t.agentWithSkills("impact", t.designImpactPrompt(), {
    label: "Mapping the change's impact",
    file: REQUIREMENTS,
    model: planner(),
    system: t.designSystem(),
  })
  requireProgress(REQUIREMENTS)
  requireCriteriaFrozen(REQUIREMENTS)
  requireImpact(REQUIREMENTS)
  requireImpactOnly(REQUIREMENTS)
}

/**
 * The skip path: when the sketch stated clear, checkable criteria, write them
 * to `.gtd/REQUIREMENTS.md` as they are and resolve `true` — no triage, no
 * design gate. `false` when design must run.
 */
export const skipDesign = (stated: StatedCriteria | undefined): Promise<boolean> =>
  stated === undefined
    ? Promise.resolve(false)
    : scope("design", async () => {
        if (!(await clear(stated))) return false
        await run("normalise", t.normaliseCriteriaScript(stated), {
          label: "Recording the stated acceptance criteria",
          file: REQUIREMENTS,
        })
        await impact()
        return true
      })

/** After a gate that invites narrowing the requirements: an edit must leave valid criteria. */
export const requireCriteriaIfEdited = (): void => {
  const change = changes().get(REQUIREMENTS)
  if (change === undefined) return
  if (change.status === "deleted")
    refuse(
      `gtd land: criteria-missing: ${REQUIREMENTS} must stay — narrow its criteria, never delete it`,
    )
  requireCriteria(REQUIREMENTS)
}
