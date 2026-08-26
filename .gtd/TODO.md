i want to simplify and unify flags and usage of `gtd next` and `gtd land`:

- without flags, both should print prose instructions that could be interpreted
  by a human or agent
  - "run this script ..."
  - "implement feature ..."
  - "review changes ..."
- there are dedicated, documenten flags to pull out specific properties of the
  result document
  - --kind
  - --content
  - --model
  - ... whatever is necessary

the goal is to completely get rid of magic shell variables and the jq dependency
and make the loops more straightforward
