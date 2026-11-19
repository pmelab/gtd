import { cn } from "../cn.js"

const FIELD = [
  "w-full min-w-0 rounded-md border border-input bg-card px-3 text-base text-foreground",
  "placeholder:text-muted-foreground transition-colors outline-none",
  "focus-visible:border-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
  "disabled:cursor-not-allowed disabled:opacity-50",
].join(" ")

export const Input = ({ className, type = "text", ...props }: React.ComponentProps<"input">) => (
  <input type={type} data-slot="input" className={cn(FIELD, "h-11 lg:h-9", className)} {...props} />
)

export const Textarea = ({ className, ...props }: React.ComponentProps<"textarea">) => (
  <textarea
    data-slot="textarea"
    className={cn(FIELD, "min-h-24 py-2 leading-normal", className)}
    {...props}
  />
)
