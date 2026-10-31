/** The unrendered `validate:` template a workflow compiler seeds for a built-in mode — quoted so a path with spaces survives interpolation. */
export const seededValidateCommand = (mode: string): string => `gtd check ${mode} "$GTD_FILE"`

/** True when `command` is exactly `mode`'s seeded template (compared literally, not rendered) — distinguishes gtd's own seeding from a user override. */
export const isSeededValidateCommand = (mode: string, command: string): boolean =>
  command === seededValidateCommand(mode)

/** The `validate:` command for a declared format: its spec travels on the command line, so `gtd check` loads no workflow to find it. */
export const declaredValidateCommand = (mode: string, spec: string): string =>
  `gtd check ${mode} "$GTD_FILE" --spec '${spec.replace(/'/g, "'\\''")}'`
