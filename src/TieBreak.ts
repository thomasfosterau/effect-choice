/**
 * How a mechanism settles a tie its own rules cannot: two candidates with
 * equal votes at every count, two bids with equal claims on the last unit of
 * an allocation.
 *
 * Mechanisms read the {@link TieBreak} reference from the context, so a tie
 * rule is chosen where the mechanism is run rather than where it is defined.
 * The default is {@link lot}, a uniformly random choice from Effect's `Random`
 * service, which is what electoral law usually prescribes; seed it with
 * `Random.withSeed` for a reproducible draw, or provide {@link first} or
 * {@link refuse} instead.
 *
 * @since 0.1.0
 */
import type * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";

/**
 * A tie the active {@link TieBreak} refused to settle.
 *
 * @since 0.1.0
 */
export class TieUnresolved extends Schema.TaggedError<
  TieUnresolved,
  { readonly brand: unique symbol }
>()("TieUnresolved", {
  /** What the tie was about, such as `"exclusion at count 7"`. */
  reason: Schema.String,
  /** How many alternatives were tied. */
  tied: Schema.Int,
}) {}

/**
 * A tie rule: picks one of `tied`, which always holds at least two values in
 * the order the mechanism found them.
 *
 * @since 0.1.0
 */
export interface Rule {
  /** Picks one of the tied values; `reason` describes the tie for logs and errors. */
  readonly choose: <A>(
    tied: Arr.NonEmptyReadonlyArray<A>,
    reason: string,
  ) => Effect.Effect<A, TieUnresolved>;
}

/**
 * Chooses uniformly at random with Effect's `Random` service: a drawing of
 * lots.
 *
 * @since 0.1.0
 */
export const lot: Rule = {
  choose: (tied) => Random.choice(tied),
};

/**
 * Chooses the first tied value in the order the mechanism found them, which
 * each mechanism documents (usually the input order).
 *
 * @since 0.1.0
 */
export const first: Rule = {
  choose: (tied) => Effect.succeed(tied[0]),
};

/**
 * Refuses every tie, failing with {@link TieUnresolved}, for when a tie
 * should go to a human.
 *
 * @since 0.1.0
 */
export const refuse: Rule = {
  choose: (tied, reason) => Effect.fail(new TieUnresolved({ reason, tied: tied.length })),
};

/**
 * The active tie rule, {@link lot} unless another is provided.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import { TieBreak } from "@thomasfosterau/effect-choice";
 *
 * declare const count: Effect.Effect<string>;
 * count.pipe(Effect.provideService(TieBreak.TieBreak, TieBreak.first));
 * ```
 *
 * @since 0.1.0
 */
export const TieBreak: Context.Reference<Rule> = Context.Reference<Rule>(
  "@thomasfosterau/effect-choice/TieBreak",
  { defaultValue: () => lot },
);

/**
 * Settles a tie with the active {@link TieBreak}, without asking it when there
 * is only one value.
 *
 * @since 0.1.0
 */
export const choose = <A>(
  tied: Arr.NonEmptyReadonlyArray<A>,
  reason: string,
): Effect.Effect<A, TieUnresolved> =>
  tied.length === 1
    ? Effect.succeed(tied[0])
    : Effect.flatMap(TieBreak, (rule) => rule.choose(tied, reason));
