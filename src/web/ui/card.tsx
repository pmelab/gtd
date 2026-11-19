import { cn } from "../cn.js"

export const Card = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="card"
    className={cn(
      "rounded-lg border border-border bg-card text-card-foreground shadow-[0_1px_2px_rgb(21_26_29/0.05)]",
      className,
    )}
    {...props}
  />
)

export const CardHeader = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="card-header"
    className={cn("flex flex-col gap-1 p-4 pb-0", className)}
    {...props}
  />
)

export const CardTitle = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="card-title"
    className={cn("text-base font-semibold leading-snug", className)}
    {...props}
  />
)

export const CardDescription = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="card-description"
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
)

export const CardContent = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div data-slot="card-content" className={cn("p-4", className)} {...props} />
)
