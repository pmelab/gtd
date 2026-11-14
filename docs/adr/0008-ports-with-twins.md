# Every external resource is a port with a twin

Git, a shell, a file outside the repository, the network and every spawned
program are reached through a port with a live and an in-memory implementation,
and a contract test runs the same cases against both. Scenarios run on the
in-memory twin, so they are fast and deterministic, and the contract test stops
the twin from drifting away from the real thing. We chose this over mocks, which
drift silently, and over running everything live, which is slow and flaky. A
scenario that needs a resource the in-memory tier lacks is a missing twin, not a
reason to run it live.
