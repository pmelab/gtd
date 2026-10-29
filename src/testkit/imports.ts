type Module = Readonly<Record<string, unknown>>

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

// Static `import`/`export … from` and bare `import "…"` statements, each
// starting a line. A clause holds names, `*`, commas and one brace group, and
// breaks lines only inside the braces, so a match cannot run past its statement.
const STATEMENT =
  /^[ \t]*(import|export)([ \t]+type)?[ \t]+([\w$* \t,]*(?:\{[^}]*\})?[\w$* \t,]*?)\s*\bfrom\s*(["'])([^"'\n]+)\4[ \t]*;?|^[ \t]*import\s*(["'])([^"'\n]+)\6[ \t]*;?/gm

interface Binding {
  readonly name: string
  readonly as: string
}

const bindings = (list: string): Binding[] =>
  list
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "" && !entry.startsWith("type "))
    .map((entry) => {
      const [name, as] = entry.split(/\s+as\s+/)
      return { name: name!, as: as ?? name! }
    })

const exportLine = (as: string, value: string): string =>
  as === "default" ? `export default ${value}` : `export const ${as} = ${value}`

type Read = (name: string) => string

const exportLines = (module: Module, m: string, read: Read, head: string, braces?: string) => {
  if (braces !== undefined) return bindings(braces).map((b) => exportLine(b.as, read(b.name)))
  if (/^\*\s+as\s+/.test(head)) return [exportLine(head.replace(/^\*\s+as\s+/, ""), m)]
  return Object.keys(module)
    .filter((name) => name !== "default" && IDENTIFIER.test(name))
    .map((name) => exportLine(name, read(name)))
}

const importLines = (m: string, read: Read, head: string, braces?: string): string[] => [
  ...head
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) =>
      part.startsWith("*")
        ? `const ${part.replace(/^\*\s+as\s+/, "")} = ${m}`
        : `const ${part} = ${read("default")}`,
    ),
  ...(braces === undefined ? [] : bindings(braces).map((b) => `const ${b.as} = ${read(b.name)}`)),
]

/**
 * `source` with each import or re-export of a specifier in `modules` reading
 * that module off `lookup(specifier)`, an expression evaluated when the
 * config runs. A string config is evaluated in memory, where no resolver
 * knows the specifier, so the binding is made by hand.
 */
export const importsFrom = (
  source: string,
  modules: Readonly<Record<string, Module>>,
  lookup: (specifier: string) => string,
): string => {
  let n = 0
  const rewrite = (kind: string, clause: string, specifier: string, module: Module): string => {
    const m = `__testkit_module_${++n}`
    const read: Read = (name) => {
      if (!(name in module))
        throw new Error(`testkit: module "${specifier}" has no export "${name}"`)
      return `${m}[${JSON.stringify(name)}]`
    }
    const text = clause.trim()
    const braces = /\{([^}]*)\}/.exec(text)?.[1]
    const head = text
      .replace(/\{[^}]*\}/, "")
      .replace(/,\s*$/, "")
      .trim()
    const lines =
      kind === "export"
        ? exportLines(module, m, read, head, braces)
        : importLines(m, read, head, braces)
    return [`const ${m} = ${lookup(specifier)}`, ...lines].join("\n")
  }
  return source.replace(
    STATEMENT,
    (
      statement,
      kind: string | undefined,
      typeOnly: string | undefined,
      clause: string | undefined,
      _q: string | undefined,
      from: string | undefined,
      _bq: string | undefined,
      bare: string | undefined,
    ) => {
      const specifier = from ?? bare!
      const module = modules[specifier]
      if (module === undefined) return statement
      if (typeOnly !== undefined || bare !== undefined) return ""
      return rewrite(kind!, clause!, specifier, module)
    },
  )
}
