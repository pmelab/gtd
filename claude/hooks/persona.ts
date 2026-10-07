import type { Turn } from "./drive"

const NEUTRAL = "You are a coding agent working on the task you are given."

// `general-purpose` cannot carry a restriction, so every prompt turn gets a
// registered persona. The name hashes everything the spec depends on: a
// `.gtdrc` change or gtd upgrade mid-session must register a fresh one.
export async function personaSpec(t: Pick<Turn, "scope" | "system" | "skills">) {
  const key = JSON.stringify([t.scope, t.system ?? "", t.skills])
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
  )
  const name =
    "p-" + Array.from(digest.slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("")
  return {
    name,
    prompt: t.system || NEUTRAL,
    skills: [...t.skills],
    disallowedTools: ["Skill"],
    permissionMode: "bypassPermissions",
  }
}
