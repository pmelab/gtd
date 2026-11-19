import { Label as LabelPrimitive } from "radix-ui"
import { cn } from "../cn.js"

export const Label = ({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) => (
  <LabelPrimitive.Root
    data-slot="label"
    className={cn(
      "flex items-center gap-3 text-sm leading-snug select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
      className,
    )}
    {...props}
  />
)
