import { ChevronDown } from "lucide-react"
import { cn } from "../cn.js"

// Native, so a phone opens its own picker.
export const NativeSelect = ({ className, ...props }: React.ComponentProps<"select">) => (
  <div className="relative w-full min-w-0">
    <select
      data-slot="native-select"
      className={cn(
        "h-11 w-full min-w-0 appearance-none rounded-md border border-input bg-card pr-9 pl-3 text-base text-foreground transition-colors outline-none lg:h-9",
        "focus-visible:border-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
    <ChevronDown
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
    />
  </div>
)
