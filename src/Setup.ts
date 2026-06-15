import setupTemplate from "./prompts/setup.md"

export const REQUIRED_SKILLS: ReadonlyArray<string> = [
  "https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs",
]

export const buildSetupPrompt = (
  skills: ReadonlyArray<string> = REQUIRED_SKILLS,
): string => {
  const bullets = skills.map((url) => `- ${url}`).join("\n")
  return setupTemplate.replace("{{SKILLS}}", bullets)
}
