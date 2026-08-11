import { createHash, randomUUID } from "node:crypto"

/**
 * A conversation's session id is DERIVED, not remembered: `uuidv5(namespace,
 * memoryKey)`, where `memoryKey` (`memoryKeyFor` in `src/Edge.ts`) is already
 * a pure function of history — `<scope>#<anchor7>`, anchored to the commit
 * the current unbroken scope-run began from. Same scope-run → same key → same
 * id → the agent resumes its conversation; a new, unbroken entry into the
 * scope changes the anchor, hence the key, hence the id → a fresh
 * conversation. Nothing is written anywhere, so a peek (`gtd next --json`)
 * and a dispatch derive the exact same id — there is no table to keep in
 * sync, no write to race, no file to go stale.
 *
 * A prompt rest with no memory key (its state is absent from `stateScopes` —
 * possible only for a hand-built definition) keeps the old ephemeral
 * behaviour instead: a random id, `resume: false` — deriving something
 * stable there would resume forever across unrelated processes, and there is
 * no history to anchor a key to anyway.
 *
 * The crash edge: an agent turn that creates session X but lands no commit
 * (a crash, a killed driver) re-derives X on the next lap with the SAME
 * `resume: false` a fresh scope-run would report, so `claude --session-id X`
 * hits "id already in use" the second time around. `resolveSession` can't see
 * that from `memoryKey`/`resume` alone — the fix lives in the driver, which
 * must treat `resume` as a HINT rather than a contract: try the flag `resume`
 * points at first, and fall back to the other on failure —
 *
 *     if [ "$resume" = true ]
 *     then agent_turn --resume || agent_turn --session-id
 *     else agent_turn --session-id || agent_turn --resume
 *     fi
 *
 * — which also makes the inverse mismatch (`resume: true`, id gone: retention
 * expired, `~/.claude/projects` wiped) recover on its own, with no file to
 * delete.
 */

/** Fixed forever — every derived session id descends from this one constant. */
export const GTD_SESSION_NAMESPACE = "ca4be249-805e-41c1-8b6a-75a11c011e25"

const toBytes = (uuid: string): Buffer => Buffer.from(uuid.replace(/-/g, ""), "hex")

const toUuidString = (bytes: Buffer): string => {
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * A UUIDv5 (RFC 4122 §4.3): `sha1(namespaceBytes ‖ nameBytes)`, the first 16
 * bytes, with the version nibble forced to `5` and the variant bits forced to
 * `10xx`. Hand-rolled over `node:crypto`'s SHA-1 rather than a dependency, so
 * its correctness is checked directly against the RFC's own DNS-namespace
 * test vector in `Sessions.test.ts` — not against this implementation's own
 * output.
 */
export const uuidv5 = (namespace: string, name: string): string => {
  const hash = createHash("sha1").update(toBytes(namespace)).update(name, "utf8").digest()
  const bytes = hash.subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return toUuidString(bytes)
}

/**
 * Resolve the session id a `prompt` rest's turn should use: `memoryKey ===
 * undefined` mints an ephemeral id via `mint` (defaults to `randomUUID`) and
 * forces `resume: false` — there is no history to derive a stable id from.
 * Otherwise the id is `uuidv5(GTD_SESSION_NAMESPACE, memoryKey)` and `resume`
 * is passed through verbatim (the caller — `src/Edge.ts`'s
 * `memoryResumedFor` — already computed it from the same trace the key came
 * from).
 */
export const resolveSession = (
  memoryKey: string | undefined,
  resume: boolean,
  mint: () => string = randomUUID,
): { readonly sessionId: string; readonly resume: boolean } =>
  memoryKey === undefined
    ? { sessionId: mint(), resume: false }
    : { sessionId: uuidv5(GTD_SESSION_NAMESPACE, memoryKey), resume }
