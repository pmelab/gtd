// A kept ref is `refs/gtd/kept/<entry>/<step>`: the step's full name must survive `git check-ref-format`.

// eslint-disable-next-line no-control-regex -- the control range IS the point
const FORBIDDEN = /[\u0000- \u007f~^:?*[\\]/

/** Why `name` cannot be (part of) a git ref name, or `undefined` when it can. */
export const refNameFault = (name: string): string | undefined => {
  if (name === "") return "it is empty"
  if (FORBIDDEN.test(name)) return "it contains a space, control character or one of ~^:?*[\\"
  if (name.includes("..")) return 'it contains ".."'
  if (name.includes("@{")) return 'it contains "@{"'
  if (name.endsWith(".")) return 'it ends with "."'
  for (const part of name.split("/")) {
    if (part === "") return 'it has an empty "/" component'
    if (part.startsWith(".")) return 'a component starts with "."'
    if (part.endsWith(".lock")) return 'a component ends with ".lock"'
  }
  return undefined
}
