import type { BlockListItem, InlineNode } from "../../steering/index.js"
import { HUNK_HREF_RE } from "./InlineRun.js"

export interface HunkLink {
  readonly href: string
  /** The text around the link, without it; absent when there is none. */
  readonly explanation?: readonly InlineNode[]
}

const childrenOf = (n: InlineNode): readonly InlineNode[] => ("children" in n ? n.children : [])

export const plainText = (inline: readonly InlineNode[]): string =>
  inline
    .map((n) =>
      n.kind === "text" || n.kind === "code"
        ? n.value
        : n.kind === "image"
          ? n.alt
          : plainText(childrenOf(n)),
    )
    .join("")

const hasLink = (inline: readonly InlineNode[], link: InlineNode): boolean =>
  inline.some((n) => n === link || hasLink(childrenOf(n), link))

const without = (inline: readonly InlineNode[], link: InlineNode): InlineNode[] =>
  inline
    .filter((n) => n !== link)
    .map((n) =>
      n.kind === "strong" || n.kind === "emphasis" || n.kind === "delete" || n.kind === "link"
        ? { ...n, children: without(n.children, link) }
        : n,
    )

const mergeTexts = (inline: readonly InlineNode[]): InlineNode[] => {
  const out: InlineNode[] = []
  for (const n of inline) {
    const prev = out[out.length - 1]
    if (n.kind === "text" && prev?.kind === "text") {
      out[out.length - 1] = {
        kind: "text",
        value: `${prev.value.trimEnd()} ${n.value.trimStart()}`,
      }
    } else out.push(n)
  }
  return out
}

/** Drops a leading `—`, `-` or `:` and trims both ends. */
const tidy = (inline: readonly InlineNode[]): InlineNode[] => {
  const out = mergeTexts(inline)
  const first = out[0]
  if (first !== undefined && first.kind !== "text") return out
  if (first) out[0] = { kind: "text", value: first.value.replace(/^\s*[—–:-]?\s*/, "") }
  const last = out[out.length - 1]
  if (last?.kind === "text") out[out.length - 1] = { kind: "text", value: last.value.trimEnd() }
  return out.filter((n) => n.kind !== "text" || n.value !== "")
}

/** Splits a run into sentences at `. `, `! ` and `? ` inside its top-level text. */
const sentences = (inline: readonly InlineNode[]): InlineNode[][] => {
  const out: InlineNode[][] = [[]]
  for (const n of inline) {
    if (n.kind !== "text") {
      out[out.length - 1]!.push(n)
      continue
    }
    const parts = n.value.split(/(?<=[.!?])\s+/)
    parts.forEach((p, i) => {
      if (i > 0) out.push([])
      out[out.length - 1]!.push({ kind: "text", value: p })
    })
  }
  return out
}

const hunkLinks = (inline: readonly InlineNode[]): InlineNode[] =>
  inline.flatMap((n) => [
    ...(n.kind === "link" && HUNK_HREF_RE.test(n.href) ? [n] : []),
    ...hunkLinks(childrenOf(n)),
  ])

const isPathText = (text: string, href: string): boolean =>
  text === href || text === href.replace(/^\.\//, "")

const explain = (run: readonly InlineNode[], link: InlineNode, wholeRun: boolean): HunkLink => {
  const href = (link as { href: string }).href
  const scope = wholeRun ? run : (sentences(run).find((s) => hasLink(s, link)) ?? run)
  const rest = tidy(without(scope, link))
  if (plainText(rest).trim() !== "") return { href, explanation: rest }
  const own = childrenOf(link)
  return plainText(own) === "" || isPathText(plainText(own), href)
    ? { href }
    : { href, explanation: own }
}

/** Hunk links of a paragraph, each with its sentence. */
export const linksOfParagraph = (inline: readonly InlineNode[]): HunkLink[] =>
  hunkLinks(inline).map((l) => explain(inline, l, false))

/** Hunk links of a list, each with its item's own text. */
export const linksOfItems = (items: readonly BlockListItem[]): HunkLink[] =>
  items.flatMap((i) => [
    ...hunkLinks(i.inline ?? []).map((l) => explain(i.inline ?? [], l, true)),
    ...linksOfItems(i.items ?? []),
  ])
