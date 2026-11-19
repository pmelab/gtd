import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../cn.js"

const alertVariants = cva(
  "grid w-full grid-cols-[0_1fr] items-start gap-y-1 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[1.25rem_1fr] has-[>svg]:gap-x-3 [&>svg]:size-5 [&>svg]:translate-y-px",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground [&>svg]:text-muted-foreground",
        destructive:
          "border-destructive/40 bg-destructive/8 text-foreground [&>svg]:text-destructive",
        warning: "border-primary/60 bg-primary/12 text-foreground [&>svg]:text-warning",
      },
    },
    defaultVariants: { variant: "default" },
  },
)

export type AlertProps = React.ComponentProps<"div"> & VariantProps<typeof alertVariants>

export const Alert = ({ className, variant, ...props }: AlertProps) => (
  <div data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />
)

export const AlertTitle = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div data-slot="alert-title" className={cn("col-start-2 font-semibold", className)} {...props} />
)

export const AlertDescription = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="alert-description"
    className={cn("col-start-2 text-muted-foreground [&_p]:leading-relaxed", className)}
    {...props}
  />
)
