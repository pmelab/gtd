import planPrompt from "./plan.md"
import buildPrompt from "./build.md"
import commitPrompt from "./commit.md"

export { planPrompt, buildPrompt, commitPrompt }

export const interpolate = (template: string, vars: Record<string, string>): string =>
  Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template,
  )
