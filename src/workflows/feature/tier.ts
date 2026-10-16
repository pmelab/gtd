import { mark, read, vars } from "../../flows/index.js"
import { REQUIREMENTS } from "../shared/steps.js"

export type RiskTier = "low" | "high"

/** GTD_FLAG_NAIVE_PASS, GTD_FLAG_RISK_TIER: both pinned at process start, so a mid-process flip never moves a process. */
export const riskTierOn = (): boolean => vars.flag_naive_pass === "1" && vars.flag_risk_tier === "1"

const sectionLines = (text: string | undefined, title: string): readonly string[] => {
  if (text === undefined) return []
  const lines = text.split(/\r?\n/)
  const heading = new RegExp(`^##[ \\t]+${title}[ \\t]*$`, "i")
  const start = lines.findIndex((line) => heading.test(line))
  if (start === -1) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^#{1,2}[ \t]/.test(line))
  return end === -1 ? rest : rest.slice(0, end)
}

/** Anything but a legible `low` is `high`: under-tiering is the risky direction. */
export const readRiskTier = (requirements: string | undefined): RiskTier => {
  const first = sectionLines(requirements, "Risk Tier").find((line) => line.trim() !== "")
  const word = first?.trim().split(/\s+/)[0]?.replace(/[`*_]/g, "").toLowerCase()
  return word === "low" ? "low" : "high"
}

// eslint-disable-next-line no-control-regex -- the control range IS the point
const CONTROL = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g

const tidy = (text: string): string => text.replace(/\s+/g, " ").replace(CONTROL, "").trim()

export const productionSignals = (requirements: string | undefined): readonly string[] => {
  const items: string[] = []
  for (const line of sectionLines(requirements, "Production Signals")) {
    const top = /^[-*+][ \t]+(.*)$/.exec(line)
    if (top !== null) items.push(top[1]!)
  }
  return items.map(tidy).filter((item) => item !== "")
}

/** The tier is always marked, first, so the last `risk-tier` mark opens the current lap's marks. */
export const recordRisk = (): RiskTier => {
  const requirements = read(REQUIREMENTS)
  const tier = readRiskTier(requirements)
  mark("risk-tier", tier)
  for (const signal of productionSignals(requirements)) mark("production-signal", signal)
  return tier
}
