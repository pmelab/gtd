// An unclosed fence runs to end of file, so the tier reads `high` (fail-closed). A backtick
// opener with a backtick in its info string still counts as a fence: deviates from CommonMark,
// worst case is `high`.
export const markFenced = (text: string): readonly { line: string; fenced: boolean }[] => {
  let fence: string | undefined // the opener run, e.g. "````"
  return text.split(/\r?\n/).map((line) => {
    const run = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    const fenced = fence !== undefined || run !== undefined
    if (fence === undefined) fence = run
    else if (
      run !== undefined &&
      run[0] === fence[0] &&
      run.length >= fence.length &&
      /^ {0,3}(`+|~+)[ \t]*$/.test(line)
    )
      fence = undefined
    return { line, fenced }
  })
}
