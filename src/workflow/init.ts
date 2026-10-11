// Unversioned on purpose: gtd init writes this into a config the project
// commits, and a schema that tracks the installed CLI ages better than a pin
// that silently goes stale. Pin a major (`@pmelab/gtd@8`) in `.gtdrc` by hand
// for the opposite trade.
const SCHEMA_URL = "https://cdn.jsdelivr.net/npm/@pmelab/gtd/schema.json"

// gtd ships no formatter, so this is the one place a default is suggested;
// only `format:` is seeded, since the built-in `qa`/`review` validators
// already do the validating.
const MODES_SUGGESTION = {
  qa: { format: 'npx prettier --write "$GTD_FILE"' },
  review: { format: 'npx prettier --write "$GTD_FILE"' },
} as const

export interface InitScaffold {
  readonly config: string
}

export const renderInitScaffold = (): InitScaffold => ({
  config: JSON.stringify({ $schema: SCHEMA_URL, modes: MODES_SUGGESTION }, null, 2) + "\n",
})
