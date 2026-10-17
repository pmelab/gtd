export type AnswerIo = {
  ended: Promise<{ ok: boolean }>
  deadline: Promise<unknown>
  read(): Promise<string>
  remove(): Promise<unknown>
}

export async function collectAnswer(io: AnswerIo): Promise<string | undefined> {
  const ended = await Promise.race([io.ended, io.deadline.then(() => undefined)])
  if (!ended) {
    // The agent may still write the file: remove it only once its turn ends.
    void io.ended.then(io.remove).catch(() => undefined)
    return undefined
  }
  try {
    return ended.ok ? await io.read() : undefined
  } catch {
    return undefined
  } finally {
    await io.remove()
  }
}
