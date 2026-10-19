import { read, refuse, scope, vars } from "../../flows/index.js"
import { HEADING, ITEM, markFenced } from "../shared/fences.js"
import { planner, REQUIREMENTS, SLICES } from "../shared/steps.js"
import * as t from "../shared/text.js"
import { defaults } from "../shared/vars.js"
import { criterionIds } from "./criteria.js"

/** One slice of the change: the criterion IDs it builds, in the order `.gtd/SLICES.md` lists them. */
export interface Slice {
  readonly title: string
  readonly ids: readonly string[]
}

const ID = /^(AC-\d+)(?![\w-])/

/** The `sliceMaxCriteria` setting. Anything but a positive integer fails rather than guess a cap. */
export const sliceCap = (): number => {
  const value = vars.sliceMaxCriteria ?? defaults.sliceMaxCriteria!
  if (!/^[1-9]\d*$/.test(value))
    refuse(`gtd: sliceMaxCriteria must be a positive integer, got ${JSON.stringify(value)}`)
  return Number(value)
}

/** Each `## ` heading of `text` with the list items under it; an item not led by an ID keeps an empty one. */
export const slicesOf = (text: string): readonly Slice[] => {
  const slices: { title: string; ids: string[] }[] = []
  for (const { line, fenced } of markFenced(text)) {
    if (fenced) continue
    const heading = HEADING.exec(line)
    if (heading !== null) {
      if (heading[1] === "##") slices.push({ title: heading[2]!, ids: [] })
      continue
    }
    const item = ITEM.exec(line)
    if (item !== null && slices.length > 0) slices.at(-1)!.ids.push(ID.exec(item[1]!)?.[1] ?? "")
  }
  return slices
}

const twice = (list: readonly string[]): string[] => [
  ...new Set(list.filter((id, i) => list.indexOf(id) !== i)),
]

/** Why `slices` fail to put each of `ids` in exactly one slice of at most `cap`, or `undefined`. */
const sliceFault = (
  slices: readonly Slice[],
  ids: readonly string[],
  cap: number,
): string | undefined => {
  const listed = slices.flatMap((s) => s.ids)
  if (slices.length === 0) return `no "## " slice`
  const empty = slices.filter((s) => s.ids.length === 0).map((s) => s.title)
  if (empty.length > 0) return `a slice with no criterion: ${empty.join(", ")}`
  if (listed.includes("")) return "a list item not led by a criterion ID"
  const over = slices.filter((s) => s.ids.length > cap).map((s) => s.title)
  if (over.length > 0) return `more than ${cap} criteria in: ${over.join(", ")}`
  const repeated = twice(listed)
  if (repeated.length > 0) return `an ID in more than one slice: ${repeated.join(", ")}`
  const unknown = listed.filter((id) => !ids.includes(id))
  if (unknown.length > 0) return `an ID ${REQUIREMENTS} does not list: ${unknown.join(", ")}`
  const missing = ids.filter((id) => !listed.includes(id))
  if (missing.length > 0) return `no slice for: ${missing.join(", ")}`
  return undefined
}

/** Refuse a turn whose `.gtd/SLICES.md` does not put each of `ids` in exactly one slice of at most `cap`. */
export const requireSlices = (ids: readonly string[], cap: number): readonly Slice[] => {
  const slices = slicesOf(read(SLICES) ?? "")
  const why = sliceFault(slices, ids, cap)
  if (why !== undefined)
    refuse(
      `gtd land: slices: ${SLICES} has ${why} — list each slice as a "## <title>" heading over "- AC-<n>" items, every criterion of ${REQUIREMENTS} in exactly one slice, at most ${cap} per slice`,
    )
  return slices
}

const ids = (): string[] => criterionIds(read(REQUIREMENTS) ?? "")

/** `slice` without the IDs a steer at `seam.steer` deleted since slicing. */
export const current = (slice: readonly string[]): string[] =>
  criterionIds(read(REQUIREMENTS) ?? "", slice)

/** The criterion IDs no slice of `earlier` builds: the last slice's, so one added at `seam.steer` is built too. */
export const unsliced = (earlier: readonly Slice[]): string[] =>
  ids().filter((id) => !earlier.some((s) => s.ids.includes(id)))

/**
 * The slices to build, in order. Criteria within `sliceMaxCriteria` are one
 * slice and no turn; above it `design.slicing` groups them.
 */
export const slicing = async (): Promise<readonly Slice[]> => {
  const all = ids()
  const cap = sliceCap()
  if (all.length <= cap) return [{ title: "", ids: all }]
  return scope("design", async () => {
    await t.agentWithSkills("slicing", t.slicingPrompt(cap), {
      label: "Slicing the change",
      file: SLICES,
      model: planner(),
      system: t.designSystem(),
    })
    return requireSlices(all, cap)
  })
}
