// What `gtd install` writes as a repository's `gtd.config.ts`. The default
// export is also exported as `feature`, so a process shows that name.
export const CONFIG_SCAFFOLD = `// The workflows gtd runs here: gtd's shipped feature, review and fix.
// Every exported function is startable with \`gtd --workflow <name>\`; the
// default export is what a change in the tree starts.
export {
  feature as default,
  feature,
  review,
  fix,
  defaults,
  envDefaults,
  summary,
  base,
  steering,
  skills,
  access,
  doors,
} from "@pmelab/gtd/workflows"
`
