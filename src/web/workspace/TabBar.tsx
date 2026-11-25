import type { LucideIcon } from "lucide-react"
import { cn } from "../cn.js"

export interface ViewTab<Id extends string> {
  readonly id: Id
  readonly label: string
  readonly icon: LucideIcon
  /** Shown as a badge when above zero; `attention` makes it yellow. */
  readonly count?: number
  readonly attention?: boolean
}

const CountBadge = ({
  count,
  attention,
}: {
  readonly count: number
  readonly attention: boolean
}) => (
  <span
    aria-hidden="true"
    className={cn(
      "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
      attention ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
    )}
  >
    {count}
  </span>
)

/**
 * The views: a bottom tab bar on a phone, an icon rail on desktop (titles
 * as tooltips unless expanded). A button's name carries its count, "Now (2)".
 */
interface ItemProps {
  readonly tab: ViewTab<string>
  readonly selected: boolean
  readonly onSelect: () => void
  /** The desktop rail's icon-only form; the title shows as a tooltip. */
  readonly collapsed?: boolean
}

const FOCUS = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"

const Spoken = ({ count = 0 }: { readonly count?: number | undefined }) =>
  count > 0 ? <span className="sr-only"> ({count})</span> : null

const SideItem = ({
  tab: { label, icon: Icon, count = 0, attention = false },
  selected,
  onSelect,
  collapsed = false,
}: ItemProps) => (
  <button
    type="button"
    aria-current={selected}
    data-testid="rail-item"
    className={cn(
      FOCUS,
      "group relative flex min-h-10 items-center rounded-md text-left text-sm",
      collapsed ? "w-10 justify-center self-center" : "gap-3 px-3",
      selected
        ? "bg-accent font-semibold text-foreground"
        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
    )}
    onClick={onSelect}
  >
    <Icon aria-hidden="true" className="size-5 shrink-0" />
    {collapsed ? (
      <>
        <span className="sr-only">
          {label}
          <Spoken count={count} />
        </span>
        {count > 0 && (
          <span className="absolute -top-1 -right-1">
            <CountBadge count={count} attention={attention} />
          </span>
        )}
        <span
          role="tooltip"
          aria-hidden="true"
          data-testid="rail-tooltip"
          className="pointer-events-none absolute top-1/2 left-full z-20 ml-2 -translate-y-1/2 rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium whitespace-nowrap text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {label}
        </span>
      </>
    ) : (
      <>
        <span className="flex-1">
          {label}
          <Spoken count={count} />
        </span>
        {count > 0 && <CountBadge count={count} attention={attention} />}
      </>
    )}
  </button>
)

const BottomItem = ({
  tab: { label, icon: Icon, count = 0, attention = false },
  selected,
  onSelect,
}: ItemProps) => (
  <button
    type="button"
    aria-current={selected}
    data-testid="tab-item"
    className={cn(
      FOCUS,
      "relative mx-1 mt-1 flex min-h-14 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[10px] font-medium",
      selected ? "bg-accent text-foreground" : "text-muted-foreground",
    )}
    onClick={onSelect}
  >
    <span className="relative flex items-center justify-center">
      <Icon aria-hidden="true" className="size-7" />
      {count > 0 && (
        <span className="absolute -top-1.5 left-full -ml-3">
          <CountBadge count={count} attention={attention} />
        </span>
      )}
    </span>
    <span>
      {label}
      <Spoken count={count} />
    </span>
  </button>
)

export const ViewNav = <Id extends string>({
  tabs,
  current,
  onSelect,
  vertical,
  collapsed = false,
  className,
}: {
  readonly tabs: readonly ViewTab<Id>[]
  readonly current: Id
  readonly onSelect: (id: Id) => void
  readonly vertical: boolean
  readonly collapsed?: boolean
  readonly className?: string
}) => (
  <nav
    className={cn("flex", vertical ? "flex-col gap-0.5" : "flex-row", className)}
    aria-label="Views"
  >
    {tabs.map((tab) => {
      const Item = vertical ? SideItem : BottomItem
      return (
        <Item
          key={tab.id}
          tab={tab}
          selected={current === tab.id}
          collapsed={vertical && collapsed}
          onSelect={() => {
            onSelect(tab.id)
          }}
        />
      )
    })}
  </nav>
)
