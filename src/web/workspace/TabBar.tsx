import { cn } from "../cn.js"

/** A row of thumb-sized tabs; the current one reads in the link colour. */
export const TabBar = <Id extends string>({
  label,
  tabs,
  current,
  onSelect,
  className,
}: {
  readonly label: string
  readonly tabs: readonly (readonly [Id, string])[]
  readonly current: Id
  readonly onSelect: (id: Id) => void
  readonly className?: string
}) => (
  <nav className={cn("flex border-divider bg-surface", className)} aria-label={label}>
    {tabs.map(([id, text]) => (
      <button
        type="button"
        key={id}
        aria-current={current === id}
        className={cn("min-h-14 flex-1 text-small", current === id ? "text-link" : "text-muted")}
        onClick={() => {
          onSelect(id)
        }}
      >
        {text}
      </button>
    ))}
  </nav>
)
