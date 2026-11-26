import { useEffect, useState } from "react"
import { Notice } from "../Notice.js"
import { Checkbox } from "../ui/checkbox.js"
import { Label } from "../ui/label.js"
import { Button } from "../Button.js"
import { environmentOf, keyBytes, pushBlock, type PushBlock } from "../push.js"
import type { DeviceState, PushSubscription } from "../../workspace/index.js"
import { workspaceTrpc } from "./api.js"

const KINDS = [
  ["needsYou", "Needs you"],
  ["error", "Error"],
  ["proposed", "Proposed"],
  ["feedFailing", "Feed failing"],
  ["configError", "Config error"],
  ["mainStale", "Main checkout stale"],
] as const

type Kind = (typeof KINDS)[number][0]
const DEFAULT_KINDS: readonly Kind[] = ["needsYou", "error"]

const firstMatch = (ua: string, table: readonly (readonly [RegExp, string])[], none: string) =>
  table.find(([pattern]) => pattern.test(ua))?.[1] ?? none

const BROWSERS = [
  [/Edg\//, "Edge"],
  [/Firefox|FxiOS/, "Firefox"],
  [/Chrome|CriOS/, "Chrome"],
  [/Safari/, "Safari"],
] as const

const SYSTEMS = [
  [/iPhone|iPad/, "iOS"],
  [/Android/, "Android"],
  [/Mac OS X/, "macOS"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
] as const

const platformOf = (ua: string): string =>
  `${firstMatch(ua, SYSTEMS, "")} ${firstMatch(ua, BROWSERS, "browser")}`.trim()

const registration = (): Promise<ServiceWorkerRegistration> => navigator.serviceWorker.ready

const usePush = (block: PushBlock | undefined) => {
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined)
  const [failure, setFailure] = useState<string>()
  const key = workspaceTrpc.pushKey.useQuery(undefined, {
    enabled: block === undefined,
  })
  const device = workspaceTrpc.pushDevice.useQuery(
    { endpoint: endpoint ?? "" },
    { enabled: typeof endpoint === "string" },
  )
  const subscribe = workspaceTrpc.pushSubscribe.useMutation()
  const unsubscribe = workspaceTrpc.pushUnsubscribe.useMutation()
  const utils = workspaceTrpc.useUtils()

  useEffect(() => {
    if (block !== undefined) return
    void registration()
      .then((r) => r.pushManager.getSubscription())
      .then((s) => {
        setEndpoint(s?.endpoint ?? null)
      })
  }, [block])

  const on = typeof endpoint === "string" && device.data !== null && device.data !== undefined
  const kinds = (device.data?.kinds ?? DEFAULT_KINDS) as readonly Kind[]

  const save = async (wanted: readonly Kind[]): Promise<void> => {
    const sub = await (await registration()).pushManager.getSubscription()
    if (sub === null) return
    await subscribe.mutateAsync({
      subscription: sub.toJSON() as PushSubscription,
      kinds: [...wanted],
      platform: platformOf(navigator.userAgent),
    })
    await utils.pushDevice.invalidate()
  }

  const turnOn = async (): Promise<void> => {
    if (key.data === undefined) return
    if ((await Notification.requestPermission()) !== "granted") {
      setFailure("Notifications are blocked for this site in the browser settings.")
      return
    }
    const sub = await (
      await registration()
    ).pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key.data),
    })
    setEndpoint(sub.endpoint)
    await save(kinds)
  }

  const turnOff = async (): Promise<void> => {
    const sub = await (await registration()).pushManager.getSubscription()
    if (sub === null) return
    await unsubscribe.mutateAsync({ endpoint: sub.endpoint })
    await sub.unsubscribe()
    setEndpoint(null)
    await utils.pushDevice.invalidate()
  }

  const run = (work: () => Promise<void>): void => {
    setFailure(undefined)
    work().catch((error: unknown) => {
      setFailure(error instanceof Error ? error.message : String(error))
    })
  }
  return {
    key,
    on,
    kinds,
    endpoint,
    failure,
    save,
    turnOn,
    turnOff,
    run,
    device: device.data,
  }
}

const DeviceFailure = ({
  device,
  onResubscribe,
}: {
  readonly device: {
    readonly platform?: string | undefined
    readonly failure?: DeviceState["failure"] | undefined
    readonly broken?: boolean | undefined
  }
  readonly onResubscribe: () => void
}) => {
  const failure = device.failure
  if (failure === undefined) return null
  return (
    <Notice tone="error">
      <p data-testid="push-device-failure">
        {device.platform ?? "This device"}: last push failed at {failure.host}
        {failure.status !== null ? ` with ${failure.status}` : ""} — {failure.message}
      </p>
      {device.broken === true && (
        <>
          <p data-testid="push-broken">
            This device is broken: the push service has refused it for a day. gtd no longer sends to
            it.
          </p>
          <Button onClick={onResubscribe}>Subscribe again</Button>
        </>
      )}
    </Notice>
  )
}

/** This device's push settings: a switch and the kinds it wants. It lists no other device. */
export const Notifications = ({ onClose }: { readonly onClose: () => void }) => {
  const block = pushBlock(environmentOf(window))
  const { key, on, kinds, endpoint, failure, save, turnOn, turnOff, run, device } = usePush(block)
  const resubscribe = () => {
    run(async () => {
      await turnOff()
      await turnOn()
    })
  }
  return (
    <section className="flex flex-col gap-4" data-testid="notifications">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Notifications</h2>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {block !== undefined ? (
        <Notice tone="error">
          <p data-testid="push-blocked">{block}</p>
        </Notice>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <Checkbox
              id="push-switch"
              className="mt-0.5"
              role="switch"
              checked={on}
              disabled={endpoint === undefined || (!on && key.data === undefined)}
              onCheckedChange={(next) => {
                run(next === true ? turnOn : turnOff)
              }}
            />
            <Label htmlFor="push-switch">Push notifications on this device</Label>
          </div>
          <fieldset className="flex flex-col gap-2" disabled={!on}>
            <legend className="mb-1 text-sm text-muted-foreground">Tell me about</legend>
            {KINDS.map(([kind, label]) => (
              <div key={kind} className="flex items-start gap-3">
                <Checkbox
                  className="mt-0.5"
                  id={`push-${kind}`}
                  checked={kinds.includes(kind)}
                  disabled={!on}
                  onCheckedChange={(next) => {
                    run(() =>
                      save(next === true ? [...kinds, kind] : kinds.filter((k) => k !== kind)),
                    )
                  }}
                />
                <Label htmlFor={`push-${kind}`}>{label}</Label>
              </div>
            ))}
          </fieldset>
          {device?.failure !== undefined && (
            <DeviceFailure device={device} onResubscribe={resubscribe} />
          )}
          {failure !== undefined && (
            <Notice tone="error">
              <p data-testid="push-failure">{failure}</p>
            </Notice>
          )}
        </>
      )}
    </section>
  )
}
