export const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

/** `command` run with `$GTD_FILE` set to `file`, the same contract a mode's `format:` command gets. */
export const withFileVar = (command: string, file: string): string =>
  `export GTD_FILE=${shellQuote(file)}\n${command}`
