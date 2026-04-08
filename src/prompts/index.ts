import planPrompt from "./plan.md"
import buildPrompt from "./build.md"
import commitPrompt from "./commit.md"
import grillPrompt from "./grill.md"
import cleanupPrompt from "./cleanup.md"

export { planPrompt, buildPrompt, commitPrompt, grillPrompt, cleanupPrompt }

export const interpolate = (template: string, vars: Record<string, string>): string =>
  Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template,
  )
