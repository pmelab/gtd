import type { SteeringViewThread } from "../steering/index.js"

/** A thread as a conversation: `H` and `A` entries visibly distinct, and a badge while the agent spoke last. */
export const Thread = ({
  thread,
  testId,
}: {
  readonly thread: SteeringViewThread
  readonly testId: string
}) => (
  <div data-testid={testId} className="flex flex-col gap-1 text-small">
    {thread.waitingOn === "human" && (
      <span
        data-testid={`${testId}-waiting`}
        className="self-start rounded bg-warning px-2 py-0.5 text-xs font-semibold text-black"
      >
        waiting on you
      </span>
    )}
    <ol className="m-0 flex list-none flex-col gap-1 p-0">
      {thread.entries.map((entry, index) => (
        <li
          key={index}
          data-testid={`${testId}-entry-${index}`}
          data-author={entry.author}
          className={
            entry.author === "me"
              ? "self-end rounded-lg bg-surface px-2 py-1 text-right"
              : "self-start rounded-lg border border-quote px-2 py-1 text-muted"
          }
        >
          <span className="font-semibold">{entry.author === "me" ? "H" : "A"}: </span>
          {entry.text}
        </li>
      ))}
    </ol>
  </div>
)
