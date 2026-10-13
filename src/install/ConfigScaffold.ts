// What `gtd install` writes as a repository's `gtd.config.ts`. The default
// export is also exported as `feature`, so a process shows that name.
export const CONFIG_SCAFFOLD = `// The workflows gtd runs here: gtd's shipped feature, review and fix.
// Every exported function is startable with \`gtd --workflow <name>\`; the
// default export is what a change in the tree starts. Each workflow brings
// its own doors: \`gtd door review [base]\` and \`gtd door fix\`.
export {
  feature as default,
  feature,
  defaults,
  envDefaults,
  summary,
  steering,
  skills,
  access,
} from "@pmelab/gtd/workflows/feature"
export { review } from "@pmelab/gtd/workflows/review"
export { fix } from "@pmelab/gtd/workflows/fix"
`
