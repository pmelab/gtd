# A process runs on its own pin

A process's first beat commits a pin — gtd's engine and the workflow bundled as
one module — and every later command in that process hands over to it. We chose
this over always running the installed gtd and refusing on a version mismatch,
so that upgrading gtd or editing the workflow cannot break a process that is
already running. Moving a running process to the live engine and workflow is an
explicit `gtd repin`.
