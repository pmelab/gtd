import { Effect } from "effect"
import { historyTrail } from "../edge/index.js"
import { combinedScript, fetchHistoryRefs } from "../emit/index.js"
import { GitService, Narrator, PROCESS_HISTORY_PREFIX } from "../platform/index.js"
import { parseCommitMessage } from "../replay/index.js"
import {
  writeJson,
  writeScript,
  type ArtifactOut,
  type CommandRequirements,
  type JsonMode,
} from "./Output.js"

export interface HistoryEntry {
  readonly ref: string
  readonly entry: string
  /** From the tip's `Gtd-Branch`; null when the finishing commit recorded none. */
  readonly branch: string | null
  readonly tip: string
  readonly date: string
  readonly subject: string
}

/** Newest tip first. */
export const historyEntries: Effect.Effect<readonly HistoryEntry[], Error, GitService> = Effect.gen(
  function* () {
    const git = yield* GitService
    // A fetched ref name is attacker-controlled: only hash suffixes are entries.
    const refs = (yield* git.listRefs(PROCESS_HISTORY_PREFIX)).filter(({ ref }) =>
      ENTRY_HASH.test(ref.slice(PROCESS_HISTORY_PREFIX.length)),
    )
    return yield* Effect.forEach(refs, ({ ref, hash, date }) =>
      Effect.gen(function* () {
        const entry = ref.slice(PROCESS_HISTORY_PREFIX.length)
        const message = parseCommitMessage(yield* git.lastCommitMessage(hash))
        return {
          ref,
          entry,
          branch: message.branch ?? null,
          tip: hash,
          date,
          subject: yield* git.lastCommitSubject(entry),
        }
      }),
    )
  },
)

const ENTRY_HASH = /^[0-9a-f]{40}([0-9a-f]{24})?$/

const HEX = /^[0-9a-f]+$/i

/**
 * Lookup order: full ref; then entry hash or hex prefix (unique → it, several
 * → fail listing them); then branch name (newest tip first, as `entries` is
 * ordered). A hex-looking name that matches no entry still resolves as a
 * branch. No match → fail.
 */
export const resolveHistoryRef = (
  arg: string,
  entries: readonly HistoryEntry[],
): Effect.Effect<HistoryEntry, Error> => {
  const byRef = entries.find((e) => e.ref === arg)
  if (byRef !== undefined) return Effect.succeed(byRef)
  if (HEX.test(arg)) {
    const lower = arg.toLowerCase()
    const matches = entries.filter((e) => e.entry.toLowerCase().startsWith(lower))
    if (matches.length === 1) return Effect.succeed(matches[0]!)
    if (matches.length > 1) {
      return Effect.fail(
        new Error(
          `gtd history: "${arg}" is ambiguous — it matches:\n${matches.map((e) => `  ${e.entry} ${e.branch ?? "-"}`).join("\n")}`,
        ),
      )
    }
  }
  const byBranch = entries.find((e) => e.branch === arg)
  if (byBranch !== undefined) return Effect.succeed(byBranch)
  return Effect.fail(new Error(`gtd history: no history ref matches "${arg}"`))
}

/** Every kept process, or those `refs` name — a branch name meaning every process kept from it, not just its newest. */
export const selectHistoryEntries = (
  refs: readonly string[],
): Effect.Effect<readonly HistoryEntry[], Error, GitService> =>
  Effect.gen(function* () {
    const entries = yield* historyEntries
    if (refs.length === 0) return entries
    const chosen = (yield* Effect.forEach(refs, (ref) =>
      resolveHistoryRef(ref, entries).pipe(
        Effect.map((hit) => (hit.branch === ref ? entries.filter((e) => e.branch === ref) : [hit])),
      ),
    )).flat()
    return chosen.filter((e, i) => chosen.findIndex((o) => o.ref === e.ref) === i)
  })

const seven = (hash: string): string => hash.slice(0, 7)

export const runHistoryListCommand = (
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const entries = yield* historyEntries
    if (yield* writeJson(json, out, entries)) return
    if (entries.length === 0) {
      out.write("no history refs; run gtd history fetch | sh to pull them\n")
      return
    }
    out.write(
      entries
        .map((e) => `${seven(e.entry)} ${e.branch ?? "-"} ${seven(e.tip)} ${e.date} ${e.subject}\n`)
        .join(""),
    )
  })

export const runHistoryShowCommand = (
  ref: string,
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  Effect.gen(function* () {
    const entry = yield* resolveHistoryRef(ref, yield* historyEntries)
    const trail = yield* historyTrail(entry.tip)
    const document = { ref: entry.ref, entry: entry.entry, branch: entry.branch, ...trail }
    if (yield* writeJson(json, out, document)) return
    if (trail.versionWarning !== undefined) {
      yield* (yield* Narrator).warn(trail.versionWarning)
    }
    const lines = [`${entry.ref} (branch ${entry.branch ?? "-"}, tip ${seven(entry.tip)})`]
    for (const step of trail.steps) {
      lines.push(`${seven(step.hash)} ${step.subject}`)
      for (const v of step.verdicts) lines.push(`  judge ${v.id} = ${v.answer} (p=${v.p})`)
      if (step.approval !== undefined) {
        lines.push(
          `  approved ${step.approval.step} by ${step.approval.name} <${step.approval.email}>`,
        )
      }
    }
    lines.push(`ended (${trail.ended})`)
    out.write(`${lines.join("\n")}\n`)
  })

/** Prints the script and never runs git: gtd's promise that it only decides and prints. */
export const runHistoryFetchCommand = (
  remote: string,
  json: JsonMode,
  out: ArtifactOut,
): Effect.Effect<void, Error, CommandRequirements> =>
  writeScript(json, out, `${combinedScript(fetchHistoryRefs(remote), "")}\n`)
