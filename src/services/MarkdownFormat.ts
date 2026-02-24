import prettier from "prettier"

export const formatMarkdown = async (content: string, filePath: string): Promise<string> => {
  const options = await prettier.resolveConfig(filePath)
  return prettier.format(content, { ...options, filepath: filePath, parser: "markdown" })
}
