import { Context, Layer } from "effect"

export class Cwd extends Context.Tag("Cwd")<Cwd, { readonly root: string }>() {
  static layer = (root: string) => Layer.succeed(Cwd, { root })
  static Live = Cwd.layer(process.cwd())
}
