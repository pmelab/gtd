interface Timer {
  readonly at: number
  readonly run: () => void
}

export interface InMemoryClock {
  /** Runs `run` once the clock has moved `ms` on; the result cancels it. */
  readonly after: (ms: number, run: () => void) => () => void
  /**
   * Moves the clock on by `ms`, firing each timer that falls due in order.
   * After each one it lets the work that timer started settle, so a timer
   * that work sets falls due in the same move.
   */
  readonly advance: (ms: number) => Promise<void>
}

/** Lets every pending promise chain run to its next real wait. */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

/** A clock that moves only when a test moves it. */
export const inMemoryClock = (): InMemoryClock => {
  let now = 0
  const timers = new Set<Timer>()
  return {
    after: (ms, run) => {
      const timer = { at: now + ms, run }
      timers.add(timer)
      return () => void timers.delete(timer)
    },
    advance: async (ms) => {
      const until = now + ms
      await settle()
      for (;;) {
        const due = [...timers]
          .filter((t) => t.at <= until)
          .sort((a, b) => a.at - b.at)
          .at(0)
        if (due === undefined) break
        timers.delete(due)
        now = due.at
        due.run()
        await settle()
      }
      now = until
    },
  }
}
