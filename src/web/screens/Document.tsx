import { GtdMark } from "../GtdMark.js"
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleDot,
  CircleHelp,
  FileDiff,
  FileSearch,
  GitCommitHorizontal,
  ListChecks,
  MessageSquarePlus,
  MessageSquareText,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type {
  BlockListItem,
  InlineNode,
  SteeringAnchor,
  SteeringView,
  SteeringViewNode,
} from "../../steering/index.js"
import { gateKind } from "../../steering/index.js"
import { Button } from "../Button.js"
import { cn } from "../cn.js"
import { Notice } from "../Notice.js"
import { NoteSheet } from "../NoteSheet.js"
import { messageForReadRefusal, SaveIndicator, useSaveIndicatorProps } from "../Refusal.js"
import { readRefusalFrom, trpc } from "../api.js"
import type { CasTokens } from "../staleRetry.js"
import { Badge } from "../ui/badge.js"
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js"
import { Checkbox } from "../ui/checkbox.js"
import { Input, Textarea } from "../ui/input.js"
import { Label } from "../ui/label.js"
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js"
import { Skeleton } from "../ui/skeleton.js"
import { cellKey, useWriteStore, WriteStoreProvider } from "../writeStore.js"
import { Hunk } from "./Hunk.js"
import { HUNK_HREF_RE, HunkOpenContext, Inline } from "./InlineRun.js"
import { NoteGestureHint, ProseBlocks } from "./ProseBlock.js"

type TokenGuardedWrite = (tokens: CasTokens) => Promise<unknown>

interface BoxValue {
  readonly checked?: boolean
  readonly text?: string
}

/** Past any document's last line: the server appends a paragraph there. */
const APPEND_LINE = Number.MAX_SAFE_INTEGER

interface WidgetActions {
  readonly checkedOf: (node: SteeringViewNode) => boolean
  readonly textOf: (node: SteeringViewNode) => string
  readonly set: (node: SteeringViewNode, value: BoxValue) => void
  readonly openNote: (anchor: SteeringAnchor) => void
  readonly openHunk: (target: HTMLElement) => void
}

const useHunkDiff = (node: SteeringViewNode) => {
  const query = trpc.diff.useQuery(
    {
      path: node.path ?? "",
      ...(node.line !== undefined ? { line: node.line } : {}),
      ...(node.endLine !== undefined ? { endLine: node.endLine } : {}),
    },
    { enabled: node.path !== undefined },
  )
  return query.data
}

/** One by-hunk page: a checklist item (tickable) or a prose link (diff only). */
type Page = SteeringViewNode

const hunkHref = (n: InlineNode): string[] =>
  n.kind === "link" && HUNK_HREF_RE.test(n.href) ? [n.href] : []

const childrenOf = (n: InlineNode): readonly InlineNode[] => ("children" in n ? n.children : [])

const inlineLinks = (inline: readonly InlineNode[]): string[] =>
  inline.flatMap((n) => [...hunkHref(n), ...inlineLinks(childrenOf(n))])

const itemLinks = (items: readonly BlockListItem[]): string[] =>
  items.flatMap((i) => [...inlineLinks(i.inline ?? []), ...itemLinks(i.items ?? [])])

const pageOfHref = (href: string, anchor: SteeringAnchor): Page => {
  const m = HUNK_HREF_RE.exec(href)!
  return {
    title: href,
    path: m[1]!,
    line: Number(m[2]),
    ...(m[3] !== undefined ? { endLine: Number(m[3]) } : {}),
    anchor,
  } as Page
}

/** Every hunk link of the document in file order: prose links and review checklist items. */
// fallow-ignore-next-line complexity
const proseLinks = (node: SteeringViewNode): string[] => [
  ...inlineLinks(node.block?.inline ?? []),
  ...itemLinks(node.block?.items ?? []),
  ...(node.body ?? []).flatMap(proseLinks),
]

const pagesOf = (nodes: readonly SteeringViewNode[]): readonly Page[] =>
  nodes.flatMap((node): readonly Page[] => [
    ...proseLinks(node).map((href) => pageOfHref(href, node.anchor)),
    ...(node.status === "review-checklist" ? (node.children ?? []) : []),
  ])

const HunkSlider = ({
  pages,
  start,
  actions,
  onClose,
  inline,
}: {
  readonly pages: readonly Page[]
  readonly start: number
  readonly actions: WidgetActions
  readonly onClose: () => void
  readonly inline: boolean
}) => {
  const [at, setIndex] = useState(start)
  const index = Math.min(at, pages.length - 1)
  const node = pages[index]!
  const diff = useHunkDiff(node)
  const go = (i: number): void => setIndex(Math.max(0, Math.min(pages.length - 1, i)))
  return (
    <div
      data-testid="hunk-slider"
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        !inline && "scrollbar-thin h-full overflow-auto",
      )}
    >
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-2 py-1 lg:px-4">
          <Button variant="ghost" data-testid="hunk-back" onClick={onClose}>
            <ArrowLeft aria-hidden="true" />
            Back to the document
          </Button>
          {/* The hunk's own header shows the count; this one is for screen readers. */}
          <span data-testid="hunk-position" className="sr-only">
            {index + 1} / {pages.length}
          </span>
        </div>
      </div>
      <div className="mx-auto w-full max-w-5xl">
        <Hunk
          node={node}
          diff={diff}
          index={index}
          total={pages.length}
          checked={actions.checkedOf(node)}
          hasNote={node.note !== undefined}
          {...(node.note !== undefined ? { note: node.note } : {})}
          onToggle={(checked) => actions.set(node, { checked })}
          onApprove={() => (index + 1 < pages.length ? go(index + 1) : onClose())}
          onOpenNote={() => actions.openNote(node.anchor)}
        />
        <div className="flex justify-between gap-2 px-4 py-3">
          <Button
            variant="secondary"
            data-testid="hunk-prev"
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            <ChevronLeft aria-hidden="true" />
            Previous
          </Button>
          <Button
            variant="secondary"
            data-testid="hunk-next"
            disabled={index + 1 >= pages.length}
            onClick={() => go(index + 1)}
          >
            Next
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  )
}

const SAVE_DELAY_MS = 800

/** A full-row label: the whole row is the hit area, at least 44px tall on a phone. */
const ROW =
  "-mx-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent lg:min-h-9"

/** The tick a widget row carries: a radio inside a single select, a checkbox otherwise. */
const Tick = ({
  type,
  value,
  checked,
  onCheckedChange,
  ...rest
}: {
  readonly type: "radio" | "checkbox"
  readonly value: string
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
  readonly "aria-label"?: string
}) =>
  type === "radio" ? (
    <RadioGroupItem value={value} {...rest} />
  ) : (
    <Checkbox checked={checked} onCheckedChange={(c) => onCheckedChange(c === true)} {...rest} />
  )

const CustomAnswer = ({
  node,
  type,
  value,
  actions,
  typedTick,
  onTypedTick,
}: {
  readonly node: SteeringViewNode
  readonly type: "radio" | "checkbox"
  readonly value: string
  readonly actions: WidgetActions
  readonly typedTick: boolean | undefined
  readonly onTypedTick: (tick: boolean | undefined) => void
}) => {
  const [text, setText] = useState(actions.textOf(node))
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latest = useRef({ text, node, actions })
  latest.current = { text, node, actions }
  const save = (next: string): void => {
    clearTimeout(timer.current)
    timer.current = undefined
    latest.current.actions.set(latest.current.node, {
      checked: next !== "",
      text: next,
    })
  }
  const flush = (next: string): void => {
    save(next)
    onTypedTick(undefined)
  }
  // Leaving the screen before the delay ends still saves the typed text.
  useEffect(
    () => () => {
      if (timer.current !== undefined) save(latest.current.text)
    },
    [],
  )
  return (
    <li className="-ml-3 flex items-center gap-1 lg:-ml-2" data-testid="widget-custom">
      <label className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-md hover:bg-accent lg:size-9">
        <Tick
          type={type}
          value={value}
          aria-label="Your own answer"
          checked={typedTick ?? actions.checkedOf(node)}
          onCheckedChange={(checked) => actions.set(node, { checked, text })}
        />
      </label>
      <Input
        placeholder="Your own answer"
        aria-label="Your own answer text"
        value={text}
        onChange={(e) => {
          const next = e.target.value
          setText(next)
          onTypedTick(next !== "")
          clearTimeout(timer.current)
          timer.current = setTimeout(() => flush(next), SAVE_DELAY_MS)
        }}
        onBlur={() => {
          if (timer.current !== undefined) flush(text)
        }}
      />
    </li>
  )
}

const OptionRow = ({
  node,
  type,
  value,
  actions,
}: {
  readonly node: SteeringViewNode
  readonly type: "radio" | "checkbox"
  readonly value: string
  readonly actions: WidgetActions
}) => (
  <li>
    <label className={ROW}>
      <Tick
        type={type}
        value={value}
        checked={actions.checkedOf(node)}
        onCheckedChange={(checked) => actions.set(node, { checked })}
      />
      <span className="min-w-0">
        <Inline inline={node.titleInline} fallback={node.title} />
      </span>
    </label>
  </li>
)

const HunkRow = ({
  node,
  actions,
}: {
  readonly node: SteeringViewNode
  readonly actions: WidgetActions
}) => (
  <li
    className="flex flex-col items-start border-b border-border py-1 last:border-b-0 lg:flex-row lg:items-center lg:gap-2"
    data-testid="widget-hunk"
  >
    <label className={cn(ROW, "w-full min-w-0 lg:mr-0 lg:flex-1")}>
      <Checkbox
        checked={actions.checkedOf(node)}
        onCheckedChange={(checked) => actions.set(node, { checked: checked === true })}
      />
      <span className="min-w-0 font-mono text-sm break-all">{node.title}</span>
    </label>
    <Button
      variant="ghost"
      size="sm"
      className="-mt-1 ml-6 lg:mt-0 lg:ml-0"
      data-hunk={node.title}
      onClick={(e) => actions.openHunk(e.currentTarget)}
    >
      <FileDiff aria-hidden="true" />
      Show the change
    </Button>
  </li>
)

const WIDGET_ICONS: Readonly<Record<string, LucideIcon>> = {
  "review-checklist": FileSearch,
  "single-select": CircleDot,
  "multi-select": ListChecks,
  boolean: CircleHelp,
}

const isWidget = (node: SteeringViewNode): boolean =>
  node.status !== undefined && WIDGET_ICONS[node.status] !== undefined

/** Consecutive prose blocks render together; each widget renders alone. */
const runsOf = (nodes: readonly SteeringViewNode[]): (readonly SteeringViewNode[])[] =>
  nodes.reduce<SteeringViewNode[][]>((runs, node) => {
    const last = runs[runs.length - 1]
    if (!isWidget(node) && last !== undefined && !isWidget(last[0]!)) last.push(node)
    else runs.push([node])
    return runs
  }, [])

const ReviewedCount = ({
  node,
  actions,
}: {
  readonly node: SteeringViewNode
  readonly actions: WidgetActions
}) => {
  const hunks = node.children ?? []
  const done = hunks.filter((h) => actions.checkedOf(h)).length
  return (
    <span
      data-testid="widget-reviewed-count"
      className="text-sm text-muted-foreground tabular-nums"
    >
      {done} of {hunks.length} reviewed
    </span>
  )
}

const WidgetHeader = ({
  node,
  actions,
}: {
  readonly node: SteeringViewNode
  readonly actions: WidgetActions
}) => {
  const Icon = WIDGET_ICONS[node.status ?? ""] ?? CircleHelp
  return (
    <header className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-1.5 pt-1.5 lg:pt-0.5">
        <h3 className="m-0 flex items-start gap-2 text-lg leading-snug font-semibold">
          <Icon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <Inline inline={node.titleInline} fallback={node.title} />
          </span>
        </h3>
        <div className="flex flex-wrap items-center gap-2 pl-6 empty:hidden">
          {node.answered === false && (
            <Badge
              variant="outline"
              className="border-warning/50 text-warning"
              data-testid="widget-required"
            >
              <CircleAlert aria-hidden="true" />
              Needs an answer
            </Badge>
          )}
          {node.status === "review-checklist" && <ReviewedCount node={node} actions={actions} />}
        </div>
      </div>
      <Button
        variant="ghost"
        className="px-3 text-muted-foreground hover:text-foreground"
        data-testid="widget-note-open"
        onClick={() => actions.openNote(node.anchor)}
      >
        <MessageSquarePlus aria-hidden="true" />
        Note
      </Button>
    </header>
  )
}

const WidgetText = ({ node }: { readonly node: SteeringViewNode }) => (
  <>
    {node.body !== undefined ? (
      <div className="mt-2 text-sm text-muted-foreground" data-testid="widget-description">
        <ProseBlocks nodes={node.body} noteOverrides={{}} onOpenNote={() => {}} readOnly />
      </div>
    ) : (
      node.detail !== undefined && (
        <p className="m-0 mt-2 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {node.detail}
        </p>
      )
    )}
    {node.note !== undefined && (
      <p
        className="m-0 mt-3 flex gap-2 rounded-md bg-muted px-3 py-2 text-sm"
        data-testid="widget-note"
      >
        <MessageSquareText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        <span className="min-w-0">{node.note}</span>
      </p>
    )}
  </>
)

/** The radio group's value: the custom row while its typed tick is on, else the first ticked option. */
const pickedValue = (
  children: readonly SteeringViewNode[],
  checked: (child: SteeringViewNode) => boolean,
  typedTick: boolean | undefined,
): string => {
  const custom = children.findIndex((c) => c.status === "custom")
  if (typedTick === true && custom >= 0) return String(custom)
  const picked = children.findIndex((c) =>
    c.status === "custom" && typedTick === false ? false : checked(c),
  )
  return picked >= 0 ? String(picked) : ""
}

const WidgetOptions = ({
  node,
  actions,
}: {
  readonly node: SteeringViewNode
  readonly actions: WidgetActions
}) => {
  const [typedTick, setTypedTick] = useState<boolean | undefined>(undefined)
  const kind = node.status ?? ""
  const children = node.children ?? []
  if (kind === "review-checklist") {
    return (
      <ul className="m-0 mt-3 flex list-none flex-col p-0">
        {children.map((child, i) => (
          <HunkRow key={i} node={child} actions={actions} />
        ))}
      </ul>
    )
  }
  const type = kind === "single-select" ? "radio" : "checkbox"
  const items = children.map((child, i) =>
    child.status === "custom" ? (
      <CustomAnswer
        key={i}
        node={child}
        type={type}
        value={String(i)}
        actions={actions}
        typedTick={typedTick}
        onTypedTick={setTypedTick}
      />
    ) : (
      <OptionRow key={i} node={child} type={type} value={String(i)} actions={actions} />
    ),
  )
  if (type === "checkbox") return <ul className="m-0 mt-3 flex list-none flex-col p-0">{items}</ul>
  return (
    <RadioGroup
      asChild
      aria-label={node.title}
      value={pickedValue(children, actions.checkedOf, typedTick)}
      onValueChange={(v) => {
        const child = children[Number(v)]
        if (child === undefined) return
        actions.set(
          child,
          child.status === "custom"
            ? { checked: true, text: actions.textOf(child) }
            : { checked: true },
        )
      }}
      className="m-0 mt-3 flex list-none flex-col gap-0 p-0"
    >
      <ul>{items}</ul>
    </RadioGroup>
  )
}

const WidgetCard = ({
  node,
  actions,
}: {
  readonly node: SteeringViewNode
  readonly actions: WidgetActions
}) => (
  <Card className="my-6">
    <section data-testid={`widget-${node.status ?? ""}`} className="p-4 lg:p-5">
      <WidgetHeader node={node} actions={actions} />
      <WidgetText node={node} />
      <WidgetOptions node={node} actions={actions} />
    </section>
  </Card>
)

const EmptyDocumentCapture = ({ onSave }: { readonly onSave: (text: string) => void }) => {
  const [text, setText] = useState("")
  return (
    <Card className="flex flex-col gap-3 p-4">
      <Label htmlFor="document-empty-textarea" className="text-base font-semibold">
        This file is empty
      </Label>
      <p className="m-0 text-sm text-muted-foreground">
        Write what the agent should know, then save.
      </p>
      <Textarea
        id="document-empty-textarea"
        data-testid="document-empty-textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-32 resize-y"
      />
      <div className="flex justify-end">
        <Button variant="primary" data-testid="document-empty-save" onClick={() => onSave(text)}>
          Save
        </Button>
      </div>
    </Card>
  )
}

/** Where the page rests, as `gtd ui`'s step reports it. */
export interface GateContext {
  readonly repo: string
  readonly branch: string
  readonly label: string
}

/** A commit message is read as the exact text it will be, not as prose. */
const isMessageFile = (filePath: string, nodes: readonly SteeringViewNode[]): boolean =>
  /message\.[^./]*$/i.test(filePath) && !nodes.some(isWidget)

/** A first heading that only says the gate kind again, under the bar that already says it. */
const repeatsTitle = (node: SteeringViewNode | undefined, kind: string): boolean =>
  node?.block?.kind === "heading" &&
  (node.note ?? "") === "" &&
  node.title.trim().toLowerCase() === kind.toLowerCase()

const COLUMN = "mx-auto w-full max-w-[calc(68ch+2rem)] px-4"

const GateHeader = ({
  filePath,
  context,
  base,
}: {
  readonly filePath: string
  readonly context: GateContext | undefined
  readonly base: string | undefined
}) => (
  <header
    data-testid="gate-header"
    className="sticky top-0 z-10 shrink-0 border-b border-border bg-card"
  >
    <div className={cn(COLUMN, "flex items-start gap-3 py-3")}>
      <GtdMark className="mt-0.5 size-9 rounded-lg dark:ring-1 dark:ring-border" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="m-0 text-xl leading-tight font-semibold tracking-tight">
          {gateKind(filePath)}
        </h1>
        {context !== undefined && (
          <p data-testid="gate-context" className="m-0 text-sm text-muted-foreground">
            <span>{context.repo}</span>
            <span aria-hidden="true"> / </span>
            <span className="font-medium text-foreground">{context.branch}</span>
            <span aria-hidden="true"> · </span>
            <span>{context.label}</span>
          </p>
        )}
        {base !== undefined && (
          <p
            data-testid="document-base"
            className="m-0 flex items-center gap-1.5 text-sm text-muted-foreground"
          >
            <GitCommitHorizontal aria-hidden="true" className="size-4 shrink-0" />
            Review base: <code className="font-mono text-foreground">{base}</code>
          </p>
        )}
      </div>
    </div>
  </header>
)

/** The page's shape while its file loads: header, a few lines, a question. */
export const DocumentSkeleton = ({ label }: { readonly label: string }) => (
  <div className="flex flex-col" aria-busy="true">
    <span className="sr-only">{label}</span>
    <div className="border-b border-border bg-card">
      <div className={cn(COLUMN, "flex flex-col gap-2 py-3")}>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>
    </div>
    <div className={cn(COLUMN, "flex flex-col gap-3 py-6")}>
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
      <Card className="mt-4 flex flex-col gap-3 p-4">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </Card>
    </div>
  </div>
)

const scrollBoxOf = (from: Element | null): Element => {
  for (let el = from?.parentElement; el; el = el.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(el).overflowY)) return el
  }
  return document.scrollingElement ?? document.documentElement
}

/**
 * Inline, the slider shares the pane's scroll with the hidden document: open it at its
 * top, not wherever the document was scrolled to, and return there when it closes.
 */
const useInlineSlideScroll = (
  inline: boolean,
  open: boolean,
  screen: { readonly current: HTMLDivElement | null },
  returnTo: { current: { readonly box: Element; readonly top: number } | undefined },
): void => {
  useLayoutEffect(() => {
    if (!inline) return
    if (open) {
      screen.current?.scrollIntoView({ block: "start" })
    } else if (returnTo.current !== undefined) {
      returnTo.current.box.scrollTop = returnTo.current.top
      returnTo.current = undefined
    }
  }, [inline, open, screen, returnTo])
}

export interface DocumentViewProps {
  readonly view: SteeringView | undefined
  readonly filePath: string
  readonly context?: GateContext | undefined
  /** Inside the dashboard's detail pane: no header, no scroll area of its own. */
  readonly inline?: boolean
  readonly isLoading: boolean
  readonly readError?: unknown
  readonly onSet?: (anchor: SteeringAnchor, value: BoxValue) => TokenGuardedWrite
  readonly onSaveNote?: (anchor: SteeringAnchor, text: string) => TokenGuardedWrite
  readonly onDone?: () => Promise<unknown>
  readonly busy?: boolean | undefined
}

const readErrorMessage = (readError: unknown): string => {
  const refusal = readError !== undefined ? readRefusalFrom(readError) : undefined
  return refusal !== undefined
    ? messageForReadRefusal(refusal)
    : "Could not load the file. Check that gtd is still running, then reload this page."
}

/** A steering file as the person sees it: prose to read and note, widgets to answer, in file order. */
// fallow-ignore-next-line complexity
export const DocumentView = ({
  view,
  filePath,
  context,
  inline = false,
  isLoading,
  readError,
  onSet,
  onSaveNote,
  onDone,
  busy,
}: DocumentViewProps) => {
  const [noteAnchor, setNoteAnchor] = useState<SteeringAnchor | undefined>(undefined)
  const [slide, setSlide] = useState<number | undefined>(undefined)
  const scroll = useRef<HTMLDivElement>(null)
  const screen = useRef<HTMLDivElement>(null)
  const returnTo = useRef<{ readonly box: Element; readonly top: number } | undefined>(undefined)
  useInlineSlideScroll(inline, slide !== undefined, screen, returnTo)
  const overlay = useWriteStore((s) => s.overlay)
  const save = useWriteStore((s) => s.save)

  if (view === undefined) {
    if (isLoading) return <DocumentSkeleton label="Loading the file…" />
    return (
      <div className="px-4 py-6">
        <Notice tone="error" className="mx-auto max-w-2xl">
          {readErrorMessage(readError)}
        </Notice>
      </div>
    )
  }

  const valueOf = (node: SteeringViewNode): BoxValue | undefined => {
    const value = overlay[cellKey(filePath, node.anchor, "value")]?.value
    return typeof value === "object" && value !== null ? (value as BoxValue) : undefined
  }
  const siblingsOf = (node: SteeringViewNode): readonly SteeringViewNode[] =>
    view.nodes.find((n) => n.children?.includes(node))?.children ?? []

  const write = (anchor: SteeringAnchor, value: BoxValue): void => {
    save({
      cell: cellKey(filePath, anchor, "value"),
      optimistic: value,
      write: onSet === undefined ? undefined : onSet(anchor, value),
    }).catch(() => {})
  }

  // A single select shows one pick at once: ticking one clears the others' ticks on screen.
  const clearSiblings = (node: SteeringViewNode): void => {
    const parent = view.nodes.find((n) => n.children?.includes(node))
    if (parent?.status !== "single-select") return
    for (const sibling of siblingsOf(node).filter((s) => s !== node)) {
      save({
        cell: cellKey(filePath, sibling.anchor, "value"),
        optimistic: { checked: false },
      }).catch(() => {})
    }
  }

  const pages = pagesOf(view.nodes)
  // A refetch can drop every page while the slider is open: fall back to the document.
  if (slide !== undefined && pages.length === 0) setSlide(undefined)
  const actions: WidgetActions = {
    // A later tick of a sibling radio unticks this one: the newest radio write wins.
    checkedOf: (node) => valueOf(node)?.checked ?? node.checked === true,
    textOf: (node) => valueOf(node)?.text ?? node.title,
    set: (node, value) => {
      write(node.anchor, value)
      if (value.checked === true) clearSiblings(node)
    },
    openNote: setNoteAnchor,
    openHunk: (target) => {
      const key = target.dataset.hunk
      const same = Array.from(scroll.current?.querySelectorAll("[data-hunk]") ?? []).filter(
        (el) => (el as HTMLElement).dataset.hunk === key,
      )
      const nth = same.indexOf(target)
      const at = pages.reduce<number[]>(
        (hits, p, i) => (p.title === key ? [...hits, i] : hits),
        [],
      )[nth]
      if (at === undefined) return
      if (inline) {
        const box = scrollBoxOf(screen.current)
        returnTo.current = { box, top: box.scrollTop }
      }
      setSlide(at)
    },
  }

  const saveNote = (anchor: SteeringAnchor, text: string): void => {
    save({
      cell: cellKey(filePath, anchor, "note"),
      optimistic: text,
      write: onSaveNote === undefined ? undefined : onSaveNote(anchor, text),
    }).catch(() => {})
  }

  const saveEmpty = (text: string): void => {
    const anchor: SteeringAnchor = { kind: "paragraph", line: APPEND_LINE }
    save({
      cell: cellKey(filePath, anchor, "note"),
      optimistic: text,
      write: onSet === undefined ? undefined : onSet(anchor, { text }),
    }).catch(() => {})
  }

  const runDone = (): void => {
    if (onDone === undefined) return
    save({
      cell: cellKey(filePath, undefined, "done"),
      optimistic: true,
      mutate: onDone,
    }).catch(() => {})
  }

  const openProseNote = (node: SteeringViewNode): void => setNoteAnchor(node.anchor)
  const message = isMessageFile(filePath, view.nodes)
  const hasProse = view.nodes.some((n) => !isWidget(n) && n.block?.kind !== "code")
  const titleRepeated = repeatsTitle(view.nodes[0], gateKind(filePath))

  return (
    <>
      <div
        ref={screen}
        data-testid="document-screen"
        className={cn("flex min-h-0 flex-1 flex-col", !inline && "h-full")}
      >
        {!inline && <GateHeader filePath={filePath} context={context} base={view.base} />}
        {slide !== undefined && pages.length > 0 && (
          <HunkSlider
            pages={pages}
            start={slide}
            inline={inline}
            actions={actions}
            onClose={() => setSlide(undefined)}
          />
        )}
        <div
          ref={scroll}
          data-testid="document-scroll"
          className={cn(
            "min-h-0 flex-1",
            !inline && "scrollbar-thin overflow-auto",
            slide !== undefined && "hidden",
          )}
        >
          <div
            className={cn(inline ? "w-full max-w-[68ch] py-2" : COLUMN, !inline && "py-6 lg:py-8")}
          >
            <HunkOpenContext.Provider value={actions.openHunk}>
              {view.nodes.length > 0 && hasProse && <NoteGestureHint />}
              {view.nodes.length === 0 ? (
                <EmptyDocumentCapture onSave={saveEmpty} />
              ) : message ? (
                <MessageCard nodes={view.nodes} onOpenNote={openProseNote} />
              ) : (
                runsOf(view.nodes).map((run, i) =>
                  isWidget(run[0]!) ? (
                    <WidgetCard key={i} node={run[0]!} actions={actions} />
                  ) : (
                    <ProseBlocks
                      key={i}
                      nodes={run}
                      hideFirst={i === 0 && titleRepeated}
                      noteOverrides={{}}
                      onOpenNote={openProseNote}
                    />
                  ),
                )
              )}
            </HunkOpenContext.Provider>
          </div>
        </div>
        {onDone !== undefined && (
          <div
            data-testid="plan-done-row"
            className={cn(
              "shrink-0 border-t border-border",
              inline ? "sticky bottom-0 z-10 bg-background" : "bg-card",
            )}
          >
            <div className={cn(inline ? "w-full" : COLUMN, "flex items-center justify-end py-3")}>
              <Button
                variant="primary"
                data-testid="plan-done"
                className="w-full lg:w-auto"
                onClick={runDone}
                disabled={busy}
              >
                <Check aria-hidden="true" />
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
      {noteAnchor !== undefined && (
        <NoteSheet
          anchor={noteAnchor}
          onSave={(anchor, text) => {
            setNoteAnchor(undefined)
            saveNote(anchor, text)
          }}
          onDismiss={() => setNoteAnchor(undefined)}
        />
      )}
    </>
  )
}

const MessageCard = ({
  nodes,
  onOpenNote,
}: {
  readonly nodes: readonly SteeringViewNode[]
  readonly onOpenNote: (node: SteeringViewNode) => void
}) => (
  <Card data-testid="commit-message">
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <GitCommitHorizontal aria-hidden="true" className="size-4" />
        Proposed commit message
      </CardTitle>
    </CardHeader>
    <CardContent className="font-mono text-sm leading-relaxed whitespace-pre-wrap [&_h2]:text-sm [&_h3]:text-sm [&_h4]:text-sm">
      <ProseBlocks nodes={nodes} noteOverrides={{}} onOpenNote={onOpenNote} />
    </CardContent>
  </Card>
)

const HandedBackPanel = ({ inline }: { readonly inline: boolean }) => (
  <Notice
    data-testid="handed-back-panel"
    role="status"
    aria-live="polite"
    className="mx-4 my-6 lg:mx-auto lg:max-w-2xl"
  >
    {inline
      ? "Handed back. This turn is done."
      : "Handed back. This turn is done; you can close this page."}
  </Notice>
)

const useDocumentMutations = (filePath: string) => {
  const utils = trpc.useUtils()
  const invalidate = () => utils.readSteeringFile.invalidate({ filePath })
  const setValue = trpc.setValue.useMutation({ onSettled: invalidate })
  const writeNote = trpc.writeNote.useMutation({ onSettled: invalidate })
  const done = trpc.done.useMutation()
  const onSet =
    (anchor: SteeringAnchor, value: BoxValue) =>
    (cas: CasTokens): Promise<unknown> =>
      setValue.mutateAsync({ filePath, ...cas, anchor, ...value })
  const onSaveNote =
    (anchor: SteeringAnchor, text: string) =>
    (cas: CasTokens): Promise<unknown> =>
      writeNote.mutateAsync({ filePath, ...cas, anchor, text })
  return {
    onSet,
    onSaveNote,
    onDone: () => done.mutateAsync({}),
    isDone: done.isSuccess,
  }
}

const DocumentInner = ({
  filePath,
  context,
  inline,
  data,
  isLoading,
  error,
}: {
  readonly filePath: string
  readonly context: GateContext | undefined
  readonly inline: boolean
  readonly data: { readonly view?: SteeringView } | undefined
  readonly isLoading: boolean
  readonly error: unknown
}) => {
  const indicatorProps = useSaveIndicatorProps()
  const pending = useWriteStore((s) => s.pendingCount)
  const { onSet, onSaveNote, onDone, isDone } = useDocumentMutations(filePath)
  const indicator = <SaveIndicator {...indicatorProps} />
  return (
    <>
      {!inline && indicator}
      {isDone ? (
        <HandedBackPanel inline={inline} />
      ) : (
        <DocumentView
          view={data?.view}
          filePath={filePath}
          context={context}
          inline={inline}
          isLoading={isLoading}
          readError={error}
          onSet={onSet}
          onSaveNote={onSaveNote}
          onDone={onDone}
          busy={pending > 0}
        />
      )}
      {/* Inline, the pane scrolls: pin the toast to its visible bottom, not to the column's top. */}
      {inline && <div className="sticky bottom-0 z-20 h-0">{indicator}</div>}
    </>
  )
}

/** The screen for every widget steering file. */
export const Document = ({
  filePath,
  context,
  inline = false,
}: {
  readonly filePath: string
  readonly context?: GateContext
  readonly inline?: boolean
}) => {
  const utils = trpc.useUtils()
  const query = trpc.readSteeringFile.useQuery({ filePath })
  const refetchTokens = async (): Promise<CasTokens> => {
    const fresh = await utils.readSteeringFile.fetch({ filePath })
    return {
      expectedHeadSha: fresh.headSha,
      expectedContentHash: fresh.contentHash,
    }
  }
  return (
    <WriteStoreProvider tokens={query.data} refetchTokens={refetchTokens}>
      <DocumentInner
        filePath={filePath}
        context={context}
        inline={inline}
        data={query.data}
        isLoading={query.isLoading}
        error={query.error}
      />
    </WriteStoreProvider>
  )
}
