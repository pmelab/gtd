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


def run_in_pty(argv):
    master, slave = pty.openpty()
    proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=slave, stderr=slave)
    os.close(slave)
    chunks = []
    while True:
        ready, _, _ = select.select([master], [], [], 1.0)
        if master in ready:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            chunks.append(data)
        if proc.poll() is not None:
            # Drain whatever the child already flushed before it exited.
            while True:
                ready, _, _ = select.select([master], [], [], 0.05)
                if master not in ready:
                    break
                try:
                    data = os.read(master, 65536)
                except OSError:
                    data = b""
                if not data:
                    break
                chunks.append(data)
            break
    os.close(master)
    proc.wait()
    return proc.returncode, b"".join(chunks)


if __name__ == "__main__":
    returncode, output = run_in_pty(["sh", "-c", sys.argv[1]])
    sys.stdout.buffer.write(output)
    sys.exit(returncode)
