// git's rules for a ref name (`git check-ref-format --branch`), in the order a
// person most likely breaks them; the first one broken is the answer.
const RULES: readonly (readonly [(name: string) => boolean, string])[] = [
  // oxlint-disable-next-line no-control-regex
  [(n) => /[\s\x00-\x1f\x7f]/.test(n), "a branch name has no spaces or control characters"],
  [(n) => n.startsWith("-"), 'a branch name does not start with "-"'],
  [(n) => n === "@", 'a branch name is not "@"'],
  [(n) => n.includes(".."), 'a branch name has no ".."'],
  [(n) => n.includes("@{"), 'a branch name has no "@{"'],
  [(n) => /[~^:?*[\\]/.test(n), "a branch name has none of ~ ^ : ? * [ \\"],
  [(n) => n.includes("//"), 'a branch name has no "//"'],
  [(n) => n.startsWith("/"), 'a branch name does not start with "/"'],
  [(n) => n.endsWith("/"), 'a branch name does not end with "/"'],
  [(n) => n.endsWith("."), 'a branch name does not end with "."'],
  [(n) => n.endsWith(".lock"), 'a branch name does not end with ".lock"'],
  [
    (n) => n.split("/").some((part) => part.startsWith(".")),
    'no part of a branch name starts with "."',
  ],
  [
    (n) => n.split("/").some((part) => part.endsWith(".lock")),
    'no part of a branch name ends with ".lock"',
  ],
]

/** Why git would refuse `name` as a new branch's name, `undefined` when it takes it. */
export const branchProblem = (name: string): string | undefined =>
  name === "" ? "the branch name is empty" : RULES.find(([breaks]) => breaks(name))?.[1]
