import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon } from "lucide-react"
import { cn } from "../cn.js"

export const Checkbox = ({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) => (
  <CheckboxPrimitive.Root
    data-slot="checkbox"
    className={cn(
      "peer size-5 shrink-0 rounded-[5px] border border-input bg-card transition-colors outline-none",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      "data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      data-slot="checkbox-indicator"
      className="grid place-content-center"
    >
      <CheckIcon className="size-3.5" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
)
