import { WIRE_SCHEMA } from "../../src/wire/constants.js"
import type { Beat, Landing } from "./drive"
import type { Judgment } from "./judge"

// The mod can meet a gtd installed apart from it (a checkout without a build
// falls back to the gtd on PATH), so each document's `schema`, never the
// package version, decides whether the mod can read it.
export function readDocument<T>(command: string, text: string): T {
  return checked(command, JSON.parse(text))
}

function checked<T>(command: string, parsed: unknown): T {
  const found = (parsed as { schema?: unknown } | null)?.schema
  if (found !== WIRE_SCHEMA) throw new Error(unsupportedSchema(command, found))
  return parsed as T
}

function unsupportedSchema(command: string, found: unknown) {
  const printed = found === undefined ? "no schema" : `schema ${JSON.stringify(found)}`
  const upgrade =
    typeof found === "number" && found > WIRE_SCHEMA
      ? "upgrade the gtd plugin to read it"
      : "upgrade gtd to the plugin's version"
  return `\`gtd ${command}\` printed ${printed}, but this gtd mod reads only schema ${WIRE_SCHEMA}: ${upgrade}.`
}

type Gtd = (args: string[], stdin?: string) => Promise<string>

// Every gtd document the mod reads goes through here, so none skips the check.
export function documents(gtd: Gtd) {
  return {
    next: async () => readDocument<Beat>("next --json", await gtd(["next", "--json"])),
    land: async (verdict?: string) => {
      const args = verdict === undefined ? ["land", "--json"] : ["judge", "answer", "--json"]
      return readDocument<Landing>(args.join(" "), await gtd(args, verdict))
    },
    // A failed or unparseable read leaves the judge step for a person to answer.
    // Only a schema the mod does not read throws, stopping the run before a
    // paid provider is asked.
    judge: async (answer: (doc: string, j: Judgment) => Promise<string | undefined>) => {
      const doc = await gtd(["judge", "--json"]).catch(() => undefined)
      if (doc === undefined) return undefined
      let parsed: unknown
      try {
        parsed = JSON.parse(doc)
      } catch {
        return undefined
      }
      return answer(doc, checked<Judgment>("judge --json", parsed))
    },
  }
}
