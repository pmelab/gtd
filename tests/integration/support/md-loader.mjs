export async function load(url, context, nextLoad) {
  if (url.endsWith(".md")) {
    const { readFile } = await import("node:fs/promises")
    const { fileURLToPath } = await import("node:url")
    const content = await readFile(fileURLToPath(url), "utf8")
    return {
      format: "module",
      source: `export default ${JSON.stringify(content)}`,
      shortCircuit: true,
    }
  }
  return nextLoad(url, context)
}
