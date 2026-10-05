// A workflow names models by role (`smart`, `base`), as hints a driver
// resolves; the bash driver does it with GTD_PLANNERMODEL / GTD_CODERMODEL.
// A subagent takes only Claude Code's own aliases, so anything else becomes
// undefined: the session's own model.

const ALIASES = ["sonnet", "opus", "haiku", "fable"] as const
type Alias = (typeof ALIASES)[number]

export type Roles = { smart?: string; base?: string }

const asAlias = (name: string): Alias | undefined =>
  ALIASES.find((a) => name === a || name.startsWith(`claude-${a}`))

export function subagentModel(hint: string | undefined, roles: Roles): Alias | undefined {
  if (!hint) return undefined
  const resolved =
    hint === "smart" ? (roles.smart ?? "opus") : hint === "base" ? (roles.base ?? "sonnet") : hint
  return asAlias(resolved)
}
