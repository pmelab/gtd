import planPrompt from "./plan.md" with { type: "text" }
import buildPrompt from "./build.md" with { type: "text" }
import learnPrompt from "./learn.md" with { type: "text" }

export { planPrompt, buildPrompt, learnPrompt }

export const interpolate = (template: string, vars: Record<string, string>): string =>
  Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template,
  )
