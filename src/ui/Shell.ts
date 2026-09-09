/**
 * Wraps `value` in single quotes with every embedded single quote escaped
 * (`'` → `'\''`), the one quoting scheme `bash` interprets literally
 * regardless of what `value` contains — command substitution, a semicolon, a
 * backtick, all inert inside single quotes. Every place in `src/ui/` that
 * interpolates a client- or `.gtdrc`-supplied string into a `runner.bash`
 * command string runs it through here first, rather than inventing its own
 * escape (`Diff.ts`'s `quotedPath` used to be a second, independent copy of
 * this exact scheme).
 */
export const singleQuoted = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`
