// The shell a step hands the driver, rendered from values the flow computed.
// Every script here is POSIX sh and runs from the repository root; none of
// them writes to git beyond the working tree.

/** POSIX single-quoting: `value` survives the shell as one word, verbatim. */
export const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

export interface CheckScriptOptions {
  /** Where a failing run's output goes, removed again by a passing one. */
  readonly report: string
  /** Written after the output, so a repeat of the same failure still changes the report. */
  readonly stamp: string
  /** Paths removed before the command runs. */
  readonly sweep?: readonly string[] | undefined
  /** Paths removed once it passes. */
  readonly sweepOnGreen?: readonly string[] | undefined
}

const removal = (paths: readonly string[]): string[] =>
  paths.length === 0 ? [] : [`rm -rf -- ${paths.map(quote).join(" ")}`]

/**
 * Run `command` and keep its outcome in the tree: on failure its output (or
 * a note that there was none) lands in `report`, on success `report` goes.
 */
export const checkScript = (command: string, options: CheckScriptOptions): string => {
  const report = quote(options.report)
  const output = quote(`${options.report}.output`)
  return [
    "#!/usr/bin/env sh",
    "set +e",
    ...removal(options.sweep ?? []),
    `mkdir -p "$(dirname ${report})"`,
    // A subshell, so an `exit` inside the command ends only the command.
    "(",
    command,
    `) > ${output} 2>&1`,
    "code=$?",
    'if [ "$code" -ne 0 ]; then',
    `  if [ -s ${output} ]; then`,
    `    mv ${output} ${report}`,
    "  else",
    `    rm -f ${output}`,
    `    printf 'the command failed with exit code %s and produced no output.' "$code" > ${report}`,
    "  fi",
    `  printf '\\n<!-- gtd check %s -->\\n' ${quote(options.stamp)} >> ${report}`,
    "else",
    `  rm -f ${output} ${report}`,
    ...removal(options.sweepOnGreen ?? []).map((line) => `  ${line}`),
    "fi",
    "",
  ].join("\n")
}

/**
 * Reverse-apply `commit`'s changes to the working tree. A failure — the
 * patch no longer applies — writes `failure` and git's error to `report`,
 * since a failed revert and one with nothing to undo both leave the tree clean.
 */
export const revertScript = (commit: string, report: string, failure: string): string => {
  const range = `${quote(`${commit}^`)} ${quote(commit)}`
  const error = quote(`${report}.output`)
  return [
    "#!/usr/bin/env sh",
    "set +e",
    `if ! git diff --quiet ${range} --; then`,
    `  mkdir -p "$(dirname ${quote(report)})"`,
    `  git diff --binary ${range} -- | git apply -R 2> ${error}`,
    "  code=$?",
    '  if [ "$code" -ne 0 ]; then',
    "    {",
    `      printf '%s\\n\\n' ${quote(failure)}`,
    `      if [ -s ${error} ]; then cat ${error}; else printf 'Reverting it exited %s and produced no output.\\n' "$code"; fi`,
    `    } > ${quote(report)}`,
    "  fi",
    `  rm -f ${error}`,
    "fi",
    "",
  ].join("\n")
}

/**
 * Undo the edits one commit made to `paths`: each goes back to its content
 * before `commit` — or away, when `commit` added it — but only while it is
 * still exactly as `commit` left it. A path changed since is left alone.
 */
export const restoreScript = (
  commit: string,
  paths: { readonly restore: readonly string[]; readonly remove: readonly string[] },
): string => {
  const unchanged = (path: string): string => `git diff --quiet ${quote(commit)} -- ${quote(path)}`
  return [
    "#!/usr/bin/env sh",
    "set +e",
    ...paths.restore.map(
      (path) =>
        `${unchanged(path)} && git restore --source=${quote(`${commit}~1`)} --worktree -- ${quote(path)}`,
    ),
    ...paths.remove.map((path) => `${unchanged(path)} && rm -f -- ${quote(path)}`),
    "",
  ].join("\n")
}

/** Remove `paths` from the working tree; absent ones are fine. */
export const removeScript = (paths: readonly string[]): string =>
  ["#!/usr/bin/env sh", ...removal(paths), ""].join("\n")

/** Move `from` to `to`, creating `to`'s directory. */
export const moveScript = (from: string, to: string): string =>
  [
    "#!/usr/bin/env sh",
    "set -e",
    `mkdir -p "$(dirname ${quote(to)})"`,
    `mv -- ${quote(from)} ${quote(to)}`,
    "",
  ].join("\n")
