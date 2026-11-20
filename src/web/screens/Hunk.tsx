import {
  Binary,
  CircleAlert,
  FileQuestion,
  FileWarning,
  MessageSquare,
  MessageSquarePlus,
} from "lucide-react"
import type { DiffResult, FileDiff } from "../../ui/index.js"
import type { SteeringViewNode } from "../../steering/index.js"
import { Button } from "../Button.js"
import { cn } from "../cn.js"
import {
  highlightDiffLine,
  TOKEN_COLOR,
  numberHunkLines,
  numberSlicedLines,
  type LineKind,
  type LineNumbers,
} from "../Highlight.js"
import { Alert, AlertDescription, AlertTitle } from "../ui/alert.js"
import { Checkbox } from "../ui/checkbox.js"
import { Skeleton } from "../ui/skeleton.js"
import { Inline } from "./InlineRun.js"

export interface HunkProps {
  /** `checked` here seeds nothing: the caller passes the live `checked` prop, since a chunk-level check-all can move it out from under this node. */
  readonly node: SteeringViewNode
  /** `undefined` only while the diff is still loading. */
  readonly diff: DiffResult | undefined
  /** This hunk's 0-based position in its deck, and the deck's size. */
  readonly index: number
  readonly total: number
  readonly checked: boolean
  readonly hasNote: boolean
  /** The attached note's text, shown in place of the note control. `hasNote` stays the flag, since a caller may know a note exists without its text. */
  readonly note?: string
  readonly onToggle: (checked: boolean) => void
  /** Fires only when ticking, never un-ticking: the tick is the approval gesture, and the caller advances the deck on it. */
  readonly onApprove: () => void
  readonly onOpenNote: () => void
}

const LINE_BACKGROUND: Readonly<Record<LineKind, string>> = {
  add: "bg-diff-add",
  del: "bg-diff-del",
  context: "bg-transparent",
  header: "bg-muted",
  // Git's `\ No newline at end of file` is none of add/del/context, so it
  // must not read as context.
  marker: "bg-muted",
}

const SIGN: Readonly<Record<LineKind, string>> = {
  add: "+",
  del: "−",
  context: "",
  header: "",
  marker: "",
}

const SIGN_COLOR: Readonly<Record<LineKind, string>> = {
  add: "text-success",
  del: "text-destructive",
  context: "",
  header: "",
  marker: "",
}

/** Each class must clear AA over both diff fills as well as the page; `tokens.test.ts` pins that. */
/** `dimmed` is opacity on the text only, never a background of its own, so a dimmed row keeps its kind's fill. */
interface DiffRow {
  readonly line: string
  readonly dimmed: boolean
  readonly numbers: LineNumbers
}

const GUTTER = "shrink-0 select-none text-right tabular-nums text-muted-foreground"

const DiffLine = ({ row, index }: { readonly row: DiffRow; readonly index: number }) => {
  const { kind, tokens } = highlightDiffLine(row.line)
  const plain = kind === "header" || kind === "marker"
  return (
    <div
      data-testid={`diff-line-${index}`}
      data-kind={kind}
      data-dimmed={row.dimmed ? true : undefined}
      // The left rule is on every row so its 2px never shifts content; only
      // its colour marks the dimmed band. Opacity alone is under 3:1 and
      // can't be seen at a glance.
      className={cn(
        "flex whitespace-pre border-l-2",
        LINE_BACKGROUND[kind],
        row.dimmed ? "border-input" : "border-transparent",
      )}
    >
      <span data-gutter="old" className={cn(GUTTER, "w-[var(--gutter)] pl-2")}>
        {row.numbers.old ?? ""}
      </span>
      <span data-gutter="new" className={cn(GUTTER, "w-[var(--gutter)] pl-2")}>
        {row.numbers.new ?? ""}
      </span>
      <span
        data-gutter="sign"
        className={cn("w-[3ch] shrink-0 select-none text-center font-semibold", SIGN_COLOR[kind])}
      >
        {SIGN[kind]}
      </span>
      {/* Opacity on this span, never the row: on the row it would also fade
          the fill. `tokens.test.ts` pins `.diff-dimmed` against AA. */}
      <span
        data-diff-code
        className={cn("pr-4", row.dimmed && "diff-dimmed", plain && "text-muted-foreground")}
      >
        {tokens.map((token, j) => (
          <span
            key={j}
            data-token-kind={token.className}
            className={token.className !== undefined ? TOKEN_COLOR[token.className] : undefined}
          >
            {token.text}
          </span>
        ))}
      </span>
    </div>
  )
}

const gutterWidth = (rows: readonly DiffRow[]): string => {
  const widest = Math.max(1, ...rows.flatMap((row) => [row.numbers.old ?? 0, row.numbers.new ?? 0]))
  return `${String(widest).length + 1}ch`
}

const DiffLines = ({ rows }: { readonly rows: readonly DiffRow[] }) => (
  <div className="scrollbar-thin overflow-x-auto rounded-lg border border-border bg-card font-mono text-small leading-6">
    {/* `min-w-max`: a block line sizes to the scroll port, not its content,
        so without it a scrolled long line shows bare page past the viewport
        edge instead of its fill, and rows would end at different widths. */}
    <div
      className="min-w-max py-1"
      style={{ "--gutter": gutterWidth(rows) } as React.CSSProperties}
    >
      {rows.map((row, i) => (
        <DiffLine key={i} row={row} index={i} />
      ))}
    </div>
  </div>
)

type DiffHunk = FileDiff["hunks"][number]

const numbersOf = (hunk: DiffHunk, whole: readonly DiffHunk[]): LineNumbers[] => {
  if (hunk.dimmed === undefined) return numberHunkLines(hunk.header, hunk.lines)
  const source = whole.find((candidate) => candidate.header === hunk.header)
  return numberSlicedLines(hunk.header, source?.lines ?? [], hunk.lines)
}

/** Every hunk's `@@` header precedes its body, so two non-contiguous regions never read as one block. */
const flattenHunks = (
  hunks: readonly DiffHunk[],
  whole: readonly DiffHunk[] = hunks,
): readonly DiffRow[] =>
  hunks.flatMap((h) => {
    const numbers = numbersOf(h, whole)
    return [
      { line: h.header, dimmed: false, numbers: {} },
      ...h.lines.map((line, i) => ({
        line,
        dimmed: h.dimmed?.[i] ?? false,
        numbers: numbers[i] ?? {},
      })),
    ]
  })

const Banner = ({
  testId,
  variant,
  icon,
  title,
  children,
}: {
  readonly testId: string
  readonly variant: "default" | "destructive" | "warning"
  readonly icon: React.ReactNode
  readonly title: string
  readonly children: React.ReactNode
}) => (
  <Alert
    variant={variant}
    data-testid={testId}
    role={variant === "destructive" ? "alert" : "status"}
  >
    {icon}
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription>{children}</AlertDescription>
  </Alert>
)

// fallow-ignore-next-line complexity
const DiffBody = ({ diff }: { readonly diff: DiffResult | undefined }) => {
  if (diff === undefined) {
    return (
      <div
        data-testid="hunk-diff-loading"
        role="status"
        className="space-y-2 rounded-lg border border-border bg-card p-3"
      >
        <span className="sr-only">Loading the diff</span>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }
  if (diff.kind === "binary") {
    return (
      <Banner
        testId="hunk-diff-binary"
        variant="default"
        icon={<Binary aria-hidden="true" />}
        title="Binary file"
      >
        This file is binary, so there is no text diff to show.
      </Banner>
    )
  }
  if (diff.kind === "no-changes") {
    return (
      <Banner
        testId="hunk-diff-no-changes"
        variant="default"
        icon={<FileQuestion aria-hidden="true" />}
        title="Nothing changed here"
      >
        This path has no changes in the review range.
      </Banner>
    )
  }
  if (diff.kind === "refused") {
    return (
      <Banner
        testId="hunk-diff-banner"
        variant="destructive"
        icon={<CircleAlert aria-hidden="true" />}
        title="Could not load the diff"
      >
        {diff.detail}
      </Banner>
    )
  }
  if (diff.kind === "whole-file") {
    return (
      <>
        <Banner
          testId="hunk-diff-banner"
          variant="warning"
          icon={<FileWarning aria-hidden="true" />}
          title="Showing the whole file"
        >
          This pointer did not resolve to a specific hunk, so the whole file's diff is shown.
        </Banner>
        <DiffLines rows={flattenHunks(diff.diff.hunks)} />
      </>
    )
  }
  return <DiffLines rows={flattenHunks(diff.hunks, diff.diff.hunks)} />
}

/** The approval is the screen's main gesture, so the whole row is the target and its checked state shows in fill, border and words, not the tick alone. */
const ApproveRow = ({
  checked,
  onToggle,
  onApprove,
}: {
  readonly checked: boolean
  readonly onToggle: (checked: boolean) => void
  readonly onApprove: () => void
}) => (
  <label
    data-testid="hunk-approve-row"
    className={cn(
      "flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-[background-color,border-color] duration-150 ease-out",
      checked ? "border-success/60 bg-success/10" : "border-border bg-card hover:bg-accent",
    )}
  >
    <Checkbox
      data-testid="hunk-tick"
      checked={checked}
      onCheckedChange={(state) => {
        const next = state === true
        onToggle(next)
        if (next) onApprove()
      }}
      className="data-[state=checked]:border-success data-[state=checked]:bg-success data-[state=checked]:text-card"
    />
    <span className={cn("text-base font-medium", checked && "text-success")}>
      {checked ? "Approved" : "Approve this hunk"}
    </span>
  </label>
)

/** With a note attached, the note itself is the control that reopens the sheet, the same rule a chunk row follows on the list screen. */
const NoteAffordance = ({
  hasNote,
  note,
  onOpenNote,
}: {
  readonly hasNote: boolean
  readonly note: string | undefined
  readonly onOpenNote: () => void
}) =>
  hasNote ? (
    <Button
      variant="secondary"
      data-testid="hunk-note-affordance"
      onClick={onOpenNote}
      className="h-auto w-full items-start justify-start py-3 text-left font-normal whitespace-normal"
    >
      <MessageSquare aria-hidden="true" className="mt-0.5 text-muted-foreground" />
      <span>{note ?? "Edit note"}</span>
    </Button>
  ) : (
    <Button
      variant="ghost"
      data-testid="hunk-note-affordance"
      onClick={onOpenNote}
      className="self-start text-muted-foreground hover:text-foreground"
    >
      <MessageSquarePlus aria-hidden="true" />
      Add note
    </Button>
  )

const splitPath = (title: string): { readonly dir: string; readonly base: string } => {
  const at = title.lastIndexOf("/", title.search(/[#\s]|$/))
  return at < 0
    ? { dir: "", base: title }
    : { dir: title.slice(0, at + 1), base: title.slice(at + 1) }
}

const HunkHeader = ({
  node,
  index,
  total,
}: {
  readonly node: SteeringViewNode
  readonly index: number
  readonly total: number
}) => {
  const { dir, base } = splitPath(node.title)
  return (
    <header className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span data-testid="hunk-progress" className="shrink-0 text-sm font-semibold tabular-nums">
          Hunk {index + 1} / {total}
        </span>
        <div
          role="progressbar"
          aria-label="Hunks in this review"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
          className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-foreground transition-[width] duration-200 ease-out"
            style={{ width: `${((index + 1) / Math.max(total, 1)) * 100}%` }}
          />
        </div>
      </div>
      {/* The directory truncates first: the file name is what tells hunks apart. */}
      <h2
        data-testid="hunk-title"
        title={node.title}
        className="flex min-w-0 font-mono text-base [overflow-wrap:normal]"
      >
        {dir !== "" && <span className="truncate text-muted-foreground">{dir}</span>}
        <span className="truncate font-semibold">{base}</span>
      </h2>
    </header>
  )
}

/** One hunk per screen; controls sit in flow below the diff, never over it. */
export const Hunk = ({
  node,
  diff,
  index,
  total,
  checked,
  hasNote,
  note,
  onToggle,
  onApprove,
  onOpenNote,
}: HunkProps) => (
  <div data-testid="hunk-screen" className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
    <HunkHeader node={node} index={index} total={total} />
    {node.detail !== undefined && node.detail.length > 0 && (
      <p data-testid="hunk-description" className="m-0 max-w-prose text-sm text-muted-foreground">
        <Inline inline={node.detailInline} fallback={node.detail} />
      </p>
    )}

    <DiffBody diff={diff} />

    <div className="flex flex-col gap-2">
      {node.checked !== undefined && (
        <ApproveRow checked={checked} onToggle={onToggle} onApprove={onApprove} />
      )}
      <NoteAffordance hasNote={hasNote} note={note} onOpenNote={onOpenNote} />
    </div>
  </div>
)
