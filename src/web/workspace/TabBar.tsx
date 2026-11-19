import { cn } from "../cn.js"

/** A row of thumb-sized tabs, or a column on desktop; the current one is bold and underlined. */
export const TabBar = <Id extends string>({
  label,
  tabs,
  current,
  onSelect,
  className,
  vertical = false,
}: {
  readonly label: string
  readonly tabs: readonly (readonly [Id, string])[]
  readonly current: Id
  readonly onSelect: (id: Id) => void
  readonly className?: string
  readonly vertical?: boolean
}) => (
  <nav
    className={cn("flex border-divider bg-surface", vertical && "flex-col", className)}
    aria-label={label}
  >
    {tabs.map(([id, text]) => (
      <button
        type="button"
        key={id}
        aria-current={current === id}
        className={cn(
          vertical ? "min-h-11 px-4 text-left text-body" : "min-h-14 flex-1 text-small",
          current === id ? "font-bold text-link underline" : "text-muted",
        )}
        onClick={() => {
          onSelect(id)
        }}
      >
        {text}
      </button>
    ))}
  </nav>
)
