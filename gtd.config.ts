// The workflows gtd runs here: gtd's shipped feature, review and fix.
// Every exported function is startable with `gtd --workflow <name>`; the
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
