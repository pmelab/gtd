# Every steering file has one widget format

Steering files once came in several formats (`qa`, `review`, `findings`, and
formats a workflow declared in code), each paired with a mode whose shell
commands a repository could replace. The editor and the phone UI each chose a
format their own way, and declared formats fell back to plain markdown in both.
We replaced them all with one format: a markdown document of typed widgets,
started by emoji headings, which gtd itself validates and serializes. A
repository can narrow the widgets a step allows, but it can no longer plug in
its own format or validator — that freedom is what kept every surface from
understanding every file.
