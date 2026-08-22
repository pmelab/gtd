import { Context, Layer } from "effect"

/** `process.env`, injected as a Context tag (mirrors `Cwd`/`RepoFiles`) so callers like `Edge.ts`'s `resolveVars` stay pure and the test world can substitute its own env map. */
export class EnvVars extends Context.Tag("EnvVars")<
  EnvVars,
  { readonly all: Readonly<Record<string, string | undefined>> }
>() {
  static layer = (all: Readonly<Record<string, string | undefined>>) =>
    Layer.succeed(EnvVars, { all })
  static Live = EnvVars.layer(process.env)
}
