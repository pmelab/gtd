#!/usr/bin/env python3
"""Run `sh -c <argv[1]>` with its stdout/stderr attached to a real pty slave.

`[ -t 1 ]` is a kernel `isatty()` check on a real file descriptor — a plain
pipe (what every other test in this suite uses to capture a script's output)
can never make it true. `OutcomeScript.test.ts` needs exactly one case where
it IS true (proving the outcome preamble still emits colour on a real tty,
now that `TERM=dumb` also has to fall through to plain), so this allocates a
throwaway pty pair with `pty.openpty()` — no controlling terminal required,
unlike `pty.spawn()` — hands the child the slave end, and streams the master
end back out on this process's own stdout for the caller to capture.

Usage: run-in-pty.py '<sh -c command>'
Exit code is the child's exit code.
"""

import os
import pty
import select
import subprocess
import sys
import time

# Wall-clock deadline for the WHOLE loop below — a child that outfills the
# pty buffer (~64 KiB on most systems) and blocks in `write()` must still be
# read from as it runs, or it never exits; this bound is what stops a child
# that also never writes and never exits. Generous (a real command under
# this suite's own full `npm test` — 10 parallel vitest workers plus
# build/lint/etc. — can be starved of CPU for seconds at a time), and the
# ONLY termination condition for such a child.
IDLE_TIMEOUT_SECONDS = 10.0
# Once the child has exited, how long the loop waits for one more chunk
# before deciding no further data is coming — short, because there is
# nothing left to race: see the loop's own comment for why closing `slave`
# only AFTER draining, never before, is what actually matters here.
SETTLE_TIMEOUT_SECONDS = 0.2


def run_in_pty(argv):
    master, slave = pty.openpty()
    proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=slave, stderr=slave)
    chunks = []
    # Read and poll together instead of `proc.wait()`-then-read: a child
    # that fills the ~64 KiB pty buffer blocks in `write()` until this
    # process drains it, so waiting for exit before the first read can
    # deadlock the child forever (it gets killed as an idle timeout, never
    # having exited). Interleaving keeps the buffer from ever filling.
    deadline = time.monotonic() + IDLE_TIMEOUT_SECONDS
    exited = False
    while True:
        timeout = (
            SETTLE_TIMEOUT_SECONDS
            if exited
            else max(0.0, min(SETTLE_TIMEOUT_SECONDS, deadline - time.monotonic()))
        )
        ready, _, _ = select.select([master], [], [], timeout)
        got_data = False
        if master in ready:
            try:
                data = os.read(master, 65536)
            except OSError:
                data = b""
            if data:
                chunks.append(data)
                got_data = True
        if not exited:
            if proc.poll() is not None:
                exited = True
                continue
            if time.monotonic() >= deadline:
                proc.kill()
                proc.wait()
                exited = True
                continue
        if exited and not got_data:
            break
    proc.wait()
    # Measured, not reasoned: this process's own `os.close(slave)` — done
    # EITHER right after spawning the child (an early version) or right
    # after `proc.wait()` above but BEFORE draining (a later one) — is what
    # loses output, independent of CPU load or elapsed time. A same-process,
    # no-load repro: spawn a child that prints one line, `proc.wait()`, close
    # `slave`, then read — the read comes back a 0-byte EOF every time, even
    # though the exact same sequence with the `close()` removed reads the
    # line back correctly after an artificial multi-second sleep. This pty
    # implementation appears to flush/drop whatever is still sitting unread
    # in the buffer at the moment every reference to the slave side closes,
    # rather than preserving it for a later read the way a plain pipe would
    # — a real hangup, not a race this loop could ever win by reading
    # faster or waiting differently. So: read everything out FIRST, close
    # LAST.
    #
    # (Two earlier versions of this loop chased a DIFFERENT theory — a
    # scheduling race between the child's exit and this process's own turn
    # to read, first "fixed" by reading to a kernel-reported real EOF
    # instead of a short poll-then-drain window, then by keeping this
    # process's own `slave` reference open so the child's exit could never
    # be the LAST close. Both were reproducible-under-load but never
    # reliable: the actual trigger is the close itself, not who does it or
    # when, so this version never closes `slave` until after the loop
    # above has already collected everything.)
    os.close(slave)
    os.close(master)
    return proc.returncode, b"".join(chunks)


if __name__ == "__main__":
    returncode, output = run_in_pty(["sh", "-c", sys.argv[1]])
    sys.stdout.buffer.write(output)
    sys.exit(returncode)
