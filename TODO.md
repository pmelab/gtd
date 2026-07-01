we need to refine the rules which commit ranges REVIEW.md should span under
which circumstances:

1. after first building a new task, it should cover the whole task
2. after providing review feedback and the build is done, the next review should
   cover only the code changes requested by the feedback
3. on a feature branch, when not within a gtd process (between "gtd: new task"
   and "gtd: done"), cover the whole branch
4. on the default branch, skip the review if not within a gtd process
