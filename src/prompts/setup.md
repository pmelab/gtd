You are an autonomous coding agent. Install the agent skills that `gtd` relies
on, then exit. Do **not** stage or commit anything in the current repository.

## Steps

1. Check whether the [skills.sh](https://www.skills.sh/) CLI (`skills`) is
   available on `$PATH`. If it is missing, follow the installer instructions at
   <https://www.skills.sh/> to install it.
2. For each skill listed below, run `skills install <git-url>`. Skip any skill
   that is already installed.
3. After installing, verify every required skill is present (e.g. via `skills
   list` or the equivalent). Do not report done until every skill is verified
   installed.

## Required skills

{{SKILLS}}
