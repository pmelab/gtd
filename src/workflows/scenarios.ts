import { head, human, read, scope } from "../flows/index.js"
import * as t from "./text.js"

/** Mutable: an accepted change moves the snapshot forward. */
export interface FrozenScenarios {
  at: string
  texts: Record<string, string>
}

/** Gherkin wording only: lines trimmed; blank, `#` comment and `@` tag lines dropped. */
export const scenarioText = (source: string): string =>
  source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("@"))
    .join("\n")

const textOf = (path: string): string | undefined => {
  const source = read(path)
  return source === undefined ? undefined : scenarioText(source)
}

/** Snapshot `.feature` paths at `head()`, merged over `previous`; `undefined` when nothing is frozen. */
export const freezeScenarios = (
  paths: readonly string[],
  previous?: FrozenScenarios,
): FrozenScenarios | undefined => {
  if (paths.length === 0) return previous
  const texts: Record<string, string> = { ...previous?.texts }
  for (const path of paths) {
    const text = textOf(path)
    if (text !== undefined) texts[path] = text
  }
  return Object.keys(texts).length === 0 ? previous : { at: head(), texts }
}

/** Paths whose wording differs from the snapshot (a deleted file counts). */
export const driftedScenarios = (frozen: FrozenScenarios): readonly string[] =>
  Object.entries(frozen.texts)
    .filter(([path, text]) => textOf(path) !== text)
    .map(([path]) => path)

const lines = (text: string | undefined): string[] =>
  (text ?? "").split("\n").filter((l) => l !== "")

/** Set difference of wording lines, not a diff: reordering alone shows nothing. */
export const wordingDrift = (frozen: FrozenScenarios, path: string): t.WordingDrift => {
  const before = lines(frozen.texts[path])
  const after = lines(textOf(path))
  return {
    path,
    removed: before.filter((l) => !after.includes(l)),
    added: after.filter((l) => !before.includes(l)),
  }
}

/** After a turn: stop at `scenario-wording` while wording drifted; accept moves the snapshot. */
export const holdWording = async (frozen: FrozenScenarios | undefined): Promise<void> => {
  if (frozen === undefined) return
  const drifted = driftedScenarios(frozen)
  if (drifted.length === 0) return
  await human("scenario-wording", {
    message: t.scenarioWordingMessage(
      frozen.at,
      drifted.map((path) => wordingDrift(frozen, path)),
    ),
    label: "Scenario wording changed",
    acceptClean: true,
    base: frozen.at,
  })
  // Still differing is accepted; restored is rejected and stays frozen as it was.
  const accepted = driftedScenarios(frozen)
  if (accepted.length === 0) return
  for (const path of accepted) {
    const text = textOf(path)
    if (text === undefined) delete frozen.texts[path]
    else frozen.texts[path] = text
  }
  frozen.at = head()
}

/** `turn`, then `holdWording`; `within` names the scope the gate rests in. */
export const guarded =
  (
    frozen: FrozenScenarios | undefined,
    turn: () => Promise<void>,
    within?: string,
  ): (() => Promise<void>) =>
  async () => {
    await turn()
    if (within === undefined) await holdWording(frozen)
    else await scope(within, () => holdWording(frozen))
  }
