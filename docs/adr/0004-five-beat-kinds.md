# Exactly five beat kinds, closed

Every rest resolves to exactly one of `capture`, `message`, `script`, `prompt`
or `stalled`, and workflows cannot add to that set. Every driver must handle
every kind, so a sixth kind would break every driver that exists. We chose a
closed set over kinds a workflow can extend: a new need is expressed as one of
the five, not as a new kind.
