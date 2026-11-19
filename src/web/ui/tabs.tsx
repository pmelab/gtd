import { Tabs as TabsPrimitive } from "radix-ui"
import { cn } from "../cn.js"

export const Tabs = ({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) => (
  <TabsPrimitive.Root
    data-slot="tabs"
    className={cn("flex flex-col gap-3", className)}
    {...props}
  />
)

export const TabsList = ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    data-slot="tabs-list"
    className={cn(
      "inline-flex w-fit items-center rounded-lg bg-muted p-1 text-muted-foreground",
      className,
    )}
    {...props}
  />
)

export const TabsTrigger = ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    data-slot="tabs-trigger"
    className={cn(
      "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors lg:min-h-8",
      "hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
      "data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_2px_rgb(21_26_29/0.08)]",
      className,
    )}
    {...props}
  />
)

export const TabsContent = ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content
    data-slot="tabs-content"
    className={cn("flex-1 outline-none", className)}
    {...props}
  />
)
