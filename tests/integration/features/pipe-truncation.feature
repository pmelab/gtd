@live
Feature: A large prompt survives its own non-zero exit through a pipe

  `nodeCliIo.exit` used to call `process.exit(code)` right after
  `process.stdout.write(chunk)`. Whenever stdout is a pipe — the normal case,
  since the whole protocol is a driver piping gtd's output into a shell — that
  write is asynchronous, and `process.exit` tears the process down before Node
  drains whatever is still queued in its internal buffer. A prompt small
  enough to fit inside the OS pipe buffer (64 KiB on Linux, smaller on macOS)
  never exercises this: the write completes synchronously and there is nothing
  left to discard. This scenario sizes the fixture well past that buffer and
  pipes `gtd next`'s exit-10 output into a consumer that deliberately sleeps
  before reading, forcing the write to queue — then compares its byte count
  against the same command redirected straight to a file. `@live` only: the
  in-memory tier never spawns a real process or a real pipe for either half of
  that comparison.

  Scenario: gtd next's large prompt is not truncated when piped into a slow, non-zero-exit consumer
    Given a test project
    And the workflow
    And a file ".gtd/NEXT.md" padded to at least 200000 bytes with a repeating line
    And an empty commit "gtd(check): packages.picking → packages.item.building"
    When I run gtd next redirected to a file and through a slow pipe
    Then it awaits the agent
    And the direct byte count exceeds 65536 bytes
    And the direct and piped byte counts are equal
