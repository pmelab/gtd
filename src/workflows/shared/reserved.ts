import type { Summary } from "../../flows/index.js"
import * as t from "./text.js"
import { REQUIREMENTS, REVIEW } from "./steps.js"

export { defaults, envDefaults } from "./vars.js"
export { skills } from "./skills.js"
export { access } from "./access.js"

export const summary: Summary = t.summaryPrompt

export const steering = { [REQUIREMENTS]: "qa", [REVIEW]: "review" }
