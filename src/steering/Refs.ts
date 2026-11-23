/** A plain `./path#a` / `./path#a-b` code reference inside text. */
export interface PathRef {
  readonly start: number
  readonly end: number
  /** Repo-relative path, no `./`. */
  readonly path: string
  readonly line: number
  readonly endLine?: number
  /** Normalised `./path#a[-b]`. */
  readonly href: string
}

// The path must have a slash or an extension, and must not continue a URL or longer word.
const REF_RE = /(?<![\w@./:#-])(\.\/)?([\w@.-]+(?:\/[\w@.-]+)*)#(\d+)(?:-(\d+))?(?![\w-])/g

/** The one rule for what counts as a code reference: used by the UI and the LSP. */
export const findRefs = (text: string): PathRef[] =>
  [...text.matchAll(REF_RE)].flatMap((m): PathRef[] => {
    const [whole, dot, path, a, b] = m
    if (dot === undefined && !path!.includes("/") && !/\.\w+$/.test(path!)) return []
    return [
      {
        start: m.index,
        end: m.index + whole.length,
        path: path!,
        line: Number(a),
        ...(b !== undefined ? { endLine: Number(b) } : {}),
        href: `./${path}#${a}${b !== undefined ? `-${b}` : ""}`,
      },
    ]
  })
