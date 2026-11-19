import { CircleAlert, Info } from "lucide-react"
import { Alert, AlertDescription } from "./ui/alert.js"

export type NoticeTone = "info" | "error"

export interface NoticeProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly tone?: NoticeTone
  readonly children: React.ReactNode
}

/** Every text-only state (loading aside): a message, an error, a refusal. */
export const Notice = ({ tone = "info", className, children, ...props }: NoticeProps) => (
  <Alert
    variant={tone === "error" ? "destructive" : "default"}
    role={tone === "error" ? "alert" : "status"}
    className={className ?? "mx-auto my-4 max-w-2xl"}
    {...props}
  >
    {tone === "error" ? <CircleAlert aria-hidden="true" /> : <Info aria-hidden="true" />}
    <AlertDescription className="text-foreground">{children}</AlertDescription>
  </Alert>
)
