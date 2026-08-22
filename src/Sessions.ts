import { createHash, randomUUID } from "node:crypto"

/** Fixed forever — every derived session id descends from this one constant. */
export const GTD_SESSION_NAMESPACE = "ca4be249-805e-41c1-8b6a-75a11c011e25"

const toBytes = (uuid: string): Buffer => Buffer.from(uuid.replace(/-/g, ""), "hex")

const toUuidString = (bytes: Buffer): string => {
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * UUIDv5 (RFC 4122 §4.3), hand-rolled over `node:crypto`'s SHA-1 rather than
 * a dependency — correctness is checked against the RFC's own DNS-namespace
 * test vector in `Sessions.test.ts`.
 */
export const uuidv5 = (namespace: string, name: string): string => {
  const hash = createHash("sha1").update(toBytes(namespace)).update(name, "utf8").digest()
  const bytes = hash.subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return toUuidString(bytes)
}

/**
 * Resolves a `prompt` rest's session id: with no `memoryKey` there's no
 * history to derive a stable id from, so it mints an ephemeral one and forces
 * `resume: false`; otherwise the id is deterministic (`uuidv5`) and `resume`
 * is passed through as given.
 */
export const resolveSession = (
  memoryKey: string | undefined,
  resume: boolean,
  mint: () => string = randomUUID,
): { readonly sessionId: string; readonly resume: boolean } =>
  memoryKey === undefined
    ? { sessionId: mint(), resume: false }
    : { sessionId: uuidv5(GTD_SESSION_NAMESPACE, memoryKey), resume }
