import { Either, Schema } from "effect"
import { WIRE_SCHEMA, type BeatDocument, type LandFields } from "../wire/index.js"

// Only the fields this loop branches on. `kind` stays a plain string so a
// kind this loop has never heard of reaches its own "unknown beat kind" arm.
const Beat = Schema.Struct({
  schema: Schema.Number,
  kind: Schema.String,
  content: Schema.String,
  idle: Schema.Boolean,
  log: Schema.String,
  state: Schema.String,
  session: Schema.optional(Schema.Struct({ id: Schema.String, resume: Schema.Boolean })),
  model: Schema.optional(Schema.String),
  system: Schema.optional(Schema.String),
  validate: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
  judge: Schema.optional(Schema.String),
})

const Land = Schema.Struct({
  schema: Schema.Number,
  script: Schema.String,
  settled: Schema.Boolean,
  idle: Schema.Boolean,
  subject: Schema.NullOr(Schema.String),
})

type Beat = typeof Beat.Type
type Land = typeof Land.Type

// Compile-time pins: the decoders read wire's own field names and types. A
// renamed or retyped wire field fails here, not on the first live run.
type Assignable<T, U> = [T] extends [U] ? true : false
type Defined<T> = { readonly [K in keyof T]-?: Exclude<T[K], undefined> }
type BeatFields = Exclude<keyof Beat, "kind">
const _beatPin: Assignable<Pick<Defined<Beat>, BeatFields>, Pick<BeatDocument, BeatFields>> = true
const _kindPin: Assignable<BeatDocument["kind"], Beat["kind"]> = true
const _landPin: Assignable<Land, Pick<LandFields, keyof Land>> = true

export type { Beat }

const decode =
  <A, I>(schema: Schema.Schema<A, I>, name: string) =>
  (stdout: string): Either.Either<A, string> => {
    let json: unknown
    try {
      json = JSON.parse(stdout)
    } catch {
      return Either.left(`${name} is not JSON:\n${stdout}`)
    }
    const version =
      typeof json === "object" && json !== null ? (json as { schema?: unknown }).schema : undefined
    if (version !== WIRE_SCHEMA) {
      return Either.left(
        `${name} has schema ${JSON.stringify(version)}, but this loop reads schema ${WIRE_SCHEMA} only — upgrade the loop's gtd`,
      )
    }
    return Schema.decodeUnknownEither(schema)(json).pipe(
      Either.mapLeft((error) => `${name} did not decode: ${error.message}`),
    )
  }

export const decodeBeat = decode(Beat, "`gtd next --json`")
export const decodeLand = decode(Land, "`gtd land --json`")
