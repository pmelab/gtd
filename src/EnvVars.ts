import { Context, Layer } from "effect"

/**
 * The process environment, injected as a Context tag — mirrors `Cwd`/
 * `WorktreeReader`: the one impure value (`process.env`) a caller needs is
 * handed in via `all`, never read directly, so `src/Edge.ts`'s `resolveVars`
 * (the three-layer `it.vars` merge — workflow default < `.gtdrc` `vars:` <
 * `GTD_VAR_`-prefixed env, highest precedence) stays a pure function of its
 * arguments, and the in-memory test world can substitute its own env map
 * without ever touching the real `process.env`.
 */
export class EnvVars extends Context.Tag("EnvVars")<
  EnvVars,
  { readonly all: Readonly<Record<string, string | undefined>> }
>() {
  static layer = (all: Readonly<Record<string, string | undefined>>) =>
    Layer.succeed(EnvVars, { all })
  static Live = EnvVars.layer(process.env)
}
