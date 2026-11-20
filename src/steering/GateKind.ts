/** `.gtd/SQUASH_MESSAGE.md` → "Squash message": the file's name is the only gate kind there is. */
export const gateKind = (filePath: string): string => {
  const stem = (filePath.split("/").pop() ?? filePath).replace(/\.[^.]*$/, "")
  const words = stem.replace(/[_-]+/g, " ").trim().toLowerCase()
  return words.length > 0 ? words[0]!.toUpperCase() + words.slice(1) : filePath
}
