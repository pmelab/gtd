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
import subprocess
import sys
import threading

# The parent's own `slave` fd is closed right after spawn, so the child holds
# the only remaining reference to it: `os.read(master, ...)` blocks until the
# child writes, and returns `b""` (or raises `OSError`/`EIO` on macOS) once
# the child's own copies of that fd are all closed — a real EOF signal, not a
# timeout guess. A poll-then-drain loop (this file's previous shape) checked
# `proc.poll()` and a `select()` readiness window separately, and could
# observe "child exited" before "child's last write arrived at the master
# end" under CPU contention, returning truncated (sometimes empty) output.
# Reading straight to EOF removes that race by construction instead of
# widening the drain timeout further.
WEDGE_BUDGET_SECONDS = 10.0


def run_in_pty(argv, timeout=WEDGE_BUDGET_SECONDS):
    master, slave = pty.openpty()
    proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=slave, stderr=slave)
    os.close(slave)

    # A genuine wedge (the read never reaching EOF — e.g. some other process
    # still holding the slave fd open) must fail fast and visibly rather than
    # consume the outer test/CI timeout: killing the child closes its fd
    # copies, which unblocks the read loop below with an EOF/OSError.
    timed_out = threading.Event()
    watchdog = threading.Timer(timeout, lambda: (timed_out.set(), proc.kill()))
    watchdog.start()

    chunks = []
    try:
        while True:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            chunks.append(data)
    finally:
        watchdog.cancel()

    os.close(master)
    proc.wait()
    if timed_out.is_set():
        raise TimeoutError(f"run-in-pty: child wedged past a {timeout}s budget")
    return proc.returncode, b"".join(chunks)


if __name__ == "__main__":
    returncode, output = run_in_pty(["sh", "-c", sys.argv[1]])
    sys.stdout.buffer.write(output)
    sys.exit(returncode)
