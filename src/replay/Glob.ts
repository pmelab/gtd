// `*` stays within one path segment, `**` crosses any number of them (zero
// included), and dotfiles are not special: this matches repository paths, not
// a shell's filename expansion.

const ESCAPE_RE = /[.+^${}()|[\]\\?]/g

const cache = new Map<string, RegExp>()

const compile = (glob: string): RegExp => {
  let pattern = "^"
  let i = 0
  while (i < glob.length) {
    const char = glob[i]!
    if (char !== "*") {
      pattern += char.replace(ESCAPE_RE, "\\$&")
      i += 1
    } else if (glob[i + 1] !== "*") {
      pattern += "[^/]*"
      i += 1
    } else if (glob[i + 2] === "/") {
      pattern += "(?:.*/)?"
      i += 3
    } else {
      pattern += ".*"
      i += 2
    }
  }
  return new RegExp(`${pattern}$`)
}

export const globMatches = (path: string, glob: string): boolean => {
  let regex = cache.get(glob)
  if (regex === undefined) {
    regex = compile(glob)
    cache.set(glob, regex)
  }
  return regex.test(path)
}
