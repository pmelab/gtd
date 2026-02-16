- immediately show a progress indication while committing human feedback
- human feedback commits should distinguish between human fixes and human
  feedback:
  - feedback is marked with `TODO: ` or `FIX:` or other similar prefixes
  - fixes are any other manual changes
  - the human feedback step should FIRST commit manual fixes (emoji: 👷), THEN
    the human feedback
