import { agent, human } from "../flows/index.js"

export const tiny = async (): Promise<void> => {
  await agent("plan", "Write PLAN.md.")
  await human("sign-off")
}

export default tiny
