Fix PR 393 review: turboArgv always passes --log-prefix=task (GitHub Actions
grouping drops task prefix, breaks dedupe and real-turbo test); full mode only
when output-logs value is full, one shared helper for both checks; hex stripping
only 16-char turbo hashes, not git shas; real-turbo test resolves turbo bin from
repo root not cwd
