/**
 * Sealed-bid, multi-unit auctions: bidders (actors) each submit sealed bids
 * for a quantity at a price, and the seller allocates its supply to the best
 * bids first.
 *
 * The rules are configurable:
 *
 * - **What a better bid is**: a higher price (`"Highest"`, the usual case) or
 *   a lower one (`"Lowest"`, for bids made in yields or rates, where a lower
 *   number means a higher price).
 * - **A reserve**: bids worse than it are rejected.
 * - **Rationing at the margin**: when the bids at the marginal price ask for
 *   more than is left, they share it `"ProRata"` in whole units (units left
 *   over by rounding go one each to the largest remainders), or are filled
 *   whole, one bid at a time, in an order the active
 *   {@link TieBreak.TieBreak} rule draws (`"ByLot"`).
 * - **Pricing**: {@link payAsBid} (discriminatory: each successful bid pays
 *   its own price), {@link uniform} (every successful bid pays the marginal
 *   accepted price), {@link firstRejected} (every successful bid pays the best
 *   rejected price: with one unit for sale, a second-price or Vickrey
 *   auction), or your own {@link Pricing}.
 *
 * Clock auctions are sequential {@link Choice.Protocol}s instead: the
 * auctioneer calls a price and asks each bidder in turn. In a {@link dutch}
 * auction the price falls until bidders take the supply; in an
 * {@link english} auction it rises until one bidder is left.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import * as Choice from "./Choice.ts";
import * as TieBreak from "./TieBreak.ts";

/**
 * One sealed bid.
 *
 * @since 0.1.0
 */
export interface Bid {
  /** Who made the bid. */
  readonly bidder: Choice.ActorId;
  /** The quantity bid for. */
  readonly quantity: number;
  /** The price bid per unit, or whatever number the auction ranks bids by, such as a yield. */
  readonly price: number;
}

/**
 * What the auction knows when it prices the successful bids.
 *
 * @since 0.1.0
 */
export interface Clearing {
  /** The worst accepted price: the marginal price. */
  readonly marginal: number;
  /** The best price rejected for want of supply, if any bid at or better than the reserve was. */
  readonly firstRejected: Option.Option<number>;
  /** The reserve, if the auction has one. */
  readonly reserve: Option.Option<number>;
}

/**
 * A pricing rule: the price a successful bid pays.
 *
 * @since 0.1.0
 */
export type Pricing = (bid: Bid, clearing: Clearing) => number;

/**
 * Discriminatory (pay-as-bid, multiple-price) pricing: each successful bid
 * pays its own price.
 *
 * @since 0.1.0
 */
export const payAsBid: Pricing = (bid) => bid.price;

/**
 * Uniform pricing: every successful bid pays the marginal (worst accepted)
 * price.
 *
 * @since 0.1.0
 */
export const uniform: Pricing = (_bid, clearing) => clearing.marginal;

/**
 * First-rejected pricing: every successful bid pays the best rejected price,
 * or the reserve (failing that, the marginal price) when no bid was rejected.
 * With one unit for sale this is a second-price (Vickrey) auction.
 *
 * @since 0.1.0
 */
export const firstRejected: Pricing = (_bid, clearing) =>
  Option.getOrElse(
    Option.orElse(clearing.firstRejected, () => clearing.reserve),
    () => clearing.marginal,
  );

/**
 * How the bids at the marginal price share what is left.
 *
 * @since 0.1.0
 */
export type Rationing = "ProRata" | "ByLot";

/**
 * The auction: what is for sale and the rules it is sold under.
 *
 * @since 0.1.0
 */
export interface Auction {
  /** The quantity for sale. */
  readonly supply: number;
  /** Whether a higher or a lower price is the better bid. Defaults to `"Highest"`. */
  readonly better?: "Highest" | "Lowest";
  /** The worst price the seller accepts. */
  readonly reserve?: number;
  /** How the marginal bids share what is left. Defaults to `"ProRata"`. */
  readonly rationing?: Rationing;
  /** The price successful bids pay. Defaults to {@link payAsBid}. */
  readonly pricing?: Pricing;
  /** The allocation unit: quantities are whole multiples of it. Defaults to `1`. */
  readonly unit?: number;
  /** The smallest quantity a bid may be for. Defaults to one unit. */
  readonly minimumBid?: number;
}

/**
 * What one bid was allocated, and at what price.
 *
 * @since 0.1.0
 */
export interface Allocation {
  /** The bid. */
  readonly bid: Bid;
  /** The quantity allocated, possibly zero. */
  readonly allocated: number;
  /** The price per unit the allocation is made at, if anything was allocated. */
  readonly price: Option.Option<number>;
}

/**
 * The result of an auction.
 *
 * @since 0.1.0
 */
export interface Result {
  /** The quantity for sale. */
  readonly supply: number;
  /** The quantity allocated: the supply, unless the auction was undersubscribed. */
  readonly allocated: number;
  /** The total quantity bid for. */
  readonly demand: number;
  /** The coverage ratio: demand over supply. */
  readonly coverage: number;
  /** The worst accepted price, if any bid succeeded. */
  readonly marginalPrice: Option.Option<number>;
  /** The share of the quantity bid at the marginal price that was allocated, in percent. */
  readonly allocatedAtMargin: Option.Option<number>;
  /** The average price bid by the successful bids, weighted by allocation. */
  readonly weightedAveragePrice: Option.Option<number>;
  /** Each bid's allocation, in the order the bids were submitted. */
  readonly allocations: ReadonlyArray<Allocation>;
}

/**
 * An auction that cannot be run.
 *
 * @since 0.1.0
 */
export class InvalidAuction extends Schema.TaggedError<
  InvalidAuction,
  { readonly brand: unique symbol }
>()("InvalidAuction", {
  /** Why the auction cannot be run. */
  reason: Schema.String,
}) {}

/**
 * A bid the auction's rules reject.
 *
 * @since 0.1.0
 */
export class InvalidBid extends Schema.TaggedError<InvalidBid, { readonly brand: unique symbol }>()(
  "InvalidBid",
  {
    /** The bid's position among the submitted bids, from 0. */
    index: Schema.Int,
    /** Why the bid is rejected. */
    reason: Schema.String,
  },
) {}

interface Entry {
  readonly index: number;
  readonly bid: Bid;
}

type Award = readonly [index: number, quantity: number];

const validate = (
  auction: Auction,
  unit: number,
  bids: ReadonlyArray<Bid>,
): Effect.Effect<void, InvalidAuction | InvalidBid> => {
  const minimum = auction.minimumBid ?? unit;
  const isMultiple = (value: number) => Number.isInteger(value / unit);
  if (!(unit > 0) || !(auction.supply > 0) || !isMultiple(auction.supply)) {
    return Effect.fail(
      new InvalidAuction({ reason: "the supply must be a positive whole number of units" }),
    );
  }
  return Effect.forEach(
    bids,
    (bid, index) =>
      !Number.isFinite(bid.price)
        ? Effect.fail(new InvalidBid({ index, reason: "the price must be a finite number" }))
        : bid.quantity < minimum || !isMultiple(bid.quantity)
          ? Effect.fail(
              new InvalidBid({
                index,
                reason: `the quantity must be a whole number of units of ${unit}, at least ${minimum}`,
              }),
            )
          : Effect.void,
    { discard: true, concurrency: 1 },
  );
};

const sumOf = (entries: ReadonlyArray<Entry>) =>
  Arr.reduce(entries, 0, (sum, entry) => sum + entry.bid.quantity);

/**
 * Shares `amount` (a whole number of units) among `entries` pro rata to their
 * quantities, giving units left over by rounding to the largest remainders.
 */
const proRata = (
  entries: ReadonlyArray<Entry>,
  amount: number,
  unit: number,
): Effect.Effect<ReadonlyArray<Award>, TieBreak.TieUnresolved> => {
  const total = sumOf(entries);
  const shares = Arr.map(entries, (entry) => {
    const exact = (entry.bid.quantity * amount) / total / unit;
    return { entry, units: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  type Share = (typeof shares)[number];
  const leftover = Math.round(amount / unit - Arr.reduce(shares, 0, (sum, s) => sum + s.units));
  const award = (
    pool: ReadonlyArray<Share>,
    left: number,
    awarded: ReadonlyArray<number>,
  ): Effect.Effect<ReadonlyArray<number>, TieBreak.TieUnresolved> => {
    const best = Math.max(...Arr.map(pool, (s) => s.remainder));
    const tied = Arr.filter(pool, (s) => s.remainder === best);
    if (left <= 0 || !Arr.isReadonlyArrayNonEmpty(tied)) {
      return Effect.succeed(awarded);
    }
    // Equal remainders are a tie only when there are fewer units than them.
    if (tied.length <= left) {
      return award(
        Arr.filter(pool, (s) => !Arr.contains(tied, s)),
        left - tied.length,
        Arr.appendAll(
          awarded,
          Arr.map(tied, (s) => s.entry.index),
        ),
      );
    }
    return TieBreak.choose(tied, "rounding at the marginal price").pipe(
      Effect.flatMap((chosen) =>
        award(
          Arr.filter(pool, (s) => s !== chosen),
          left - 1,
          Arr.append(awarded, chosen.entry.index),
        ),
      ),
    );
  };
  return award(shares, leftover, []).pipe(
    Effect.map((awarded) =>
      Arr.map(shares, (s): Award => [
        s.entry.index,
        (s.units + (Arr.contains(awarded, s.entry.index) ? 1 : 0)) * unit,
      ]),
    ),
  );
};

/** Fills whole bids from `entries` in an order drawn by the tie rule, the last one partly. */
const byLot = (
  entries: ReadonlyArray<Entry>,
  amount: number,
): Effect.Effect<ReadonlyArray<Award>, TieBreak.TieUnresolved> => {
  const draw = (
    pool: ReadonlyArray<Entry>,
    left: number,
    awarded: ReadonlyArray<Award>,
  ): Effect.Effect<ReadonlyArray<Award>, TieBreak.TieUnresolved> =>
    !Arr.isReadonlyArrayNonEmpty(pool)
      ? Effect.succeed(awarded)
      : left <= 0
        ? Effect.succeed(
            Arr.appendAll(
              awarded,
              Arr.map(pool, (entry): Award => [entry.index, 0]),
            ),
          )
        : TieBreak.choose(pool, "rationing at the marginal price").pipe(
            Effect.flatMap((chosen) => {
              const quantity = Math.min(chosen.bid.quantity, left);
              return draw(
                Arr.filter(pool, (entry) => entry !== chosen),
                left - quantity,
                Arr.append(awarded, [chosen.index, quantity]),
              );
            }),
          );
  return draw(entries, amount, []);
};

/**
 * Runs `auction` on `bids`.
 *
 * Fails with {@link InvalidAuction} or {@link InvalidBid} when the auction or
 * a bid breaks the rules, and with {@link TieBreak.TieUnresolved} when a tie
 * at the margin reaches a tie rule that refuses it.
 *
 * @example
 * ```ts
 * import { Auction, Choice } from "@thomasfosterau/effect-choice";
 *
 * // A sealed second-price auction for one item.
 * const result = Auction.run({ supply: 1, pricing: Auction.firstRejected }, [
 *   { bidder: Choice.ActorId("ada"), quantity: 1, price: 120 },
 *   { bidder: Choice.ActorId("bea"), quantity: 1, price: 100 },
 * ]);
 * ```
 *
 * @since 0.1.0
 */
export const run = (
  auction: Auction,
  bids: ReadonlyArray<Bid>,
): Effect.Effect<Result, InvalidAuction | InvalidBid | TieBreak.TieUnresolved> =>
  Effect.gen(function* () {
    const unit = auction.unit ?? 1;
    yield* validate(auction, unit, bids);
    const better = auction.better ?? "Highest";
    const isAcceptable = (price: number) =>
      auction.reserve === undefined ||
      (better === "Highest" ? price >= auction.reserve : price <= auction.reserve);
    const entries = Arr.map(bids, (bid, index): Entry => ({ index, bid }));
    const levels = Arr.dedupe(
      Arr.sort(
        Arr.filter(
          Arr.map(bids, (bid) => bid.price),
          isAcceptable,
        ),
        better === "Highest" ? Order.flip(Order.Number) : Order.Number,
      ),
    );
    interface Filling {
      readonly remaining: number;
      readonly awards: ReadonlyArray<Award>;
    }
    const filled = yield* Effect.reduce(
      levels,
      (): Filling => ({ remaining: auction.supply, awards: [] }),
      (state: Filling, level: number): Effect.Effect<Filling, TieBreak.TieUnresolved> => {
        const atLevel = Arr.filter(entries, (entry) => entry.bid.price === level);
        const wanted = sumOf(atLevel);
        if (state.remaining <= 0) {
          return Effect.succeed(state);
        }
        if (wanted <= state.remaining) {
          return Effect.succeed({
            remaining: state.remaining - wanted,
            awards: Arr.appendAll(
              state.awards,
              Arr.map(atLevel, (entry): Award => [entry.index, entry.bid.quantity]),
            ),
          });
        }
        const share =
          (auction.rationing ?? "ProRata") === "ProRata"
            ? proRata(atLevel, state.remaining, unit)
            : byLot(atLevel, state.remaining);
        return share.pipe(
          Effect.map((awards) => ({ remaining: 0, awards: Arr.appendAll(state.awards, awards) })),
        );
      },
    );
    const allocatedTo = (index: number) =>
      Option.getOrElse(
        Option.map(
          Arr.findFirst(filled.awards, ([i]) => i === index),
          ([, quantity]) => quantity,
        ),
        () => 0,
      );
    const successful = Arr.filter(entries, (entry) => allocatedTo(entry.index) > 0);
    const worst = (prices: Arr.NonEmptyReadonlyArray<number>) =>
      better === "Highest" ? Math.min(...prices) : Math.max(...prices);
    const best = (prices: Arr.NonEmptyReadonlyArray<number>) =>
      better === "Highest" ? Math.max(...prices) : Math.min(...prices);
    const marginalPrice = Arr.match(successful, {
      onEmpty: () => Option.none<number>(),
      onNonEmpty: (all) => Option.some(worst(Arr.map(all, (entry) => entry.bid.price))),
    });
    // Bids rejected for want of supply; those below the reserve never competed.
    const rejected = Arr.filter(
      entries,
      (entry) => allocatedTo(entry.index) === 0 && isAcceptable(entry.bid.price),
    );
    const clearing = Option.map(marginalPrice, (marginal): Clearing => ({
      marginal,
      firstRejected: Arr.match(rejected, {
        onEmpty: () => Option.none(),
        onNonEmpty: (all) => Option.some(best(Arr.map(all, (entry) => entry.bid.price))),
      }),
      reserve: Option.fromUndefinedOr(auction.reserve),
    }));
    const pricing = auction.pricing ?? payAsBid;
    const allocated = auction.supply - filled.remaining;
    const demand = Arr.reduce(bids, 0, (sum, bid) => sum + bid.quantity);
    return {
      supply: auction.supply,
      allocated,
      demand,
      coverage: demand / auction.supply,
      marginalPrice,
      allocatedAtMargin: Option.map(marginalPrice, (marginal) => {
        const atMargin = Arr.filter(entries, (entry) => entry.bid.price === marginal);
        const got = Arr.reduce(atMargin, 0, (sum, entry) => sum + allocatedTo(entry.index));
        return (got / sumOf(atMargin)) * 100;
      }),
      weightedAveragePrice:
        allocated > 0
          ? Option.some(
              Arr.reduce(
                successful,
                0,
                (sum, entry) => sum + allocatedTo(entry.index) * entry.bid.price,
              ) / allocated,
            )
          : Option.none(),
      allocations: Arr.map(entries, (entry): Allocation => {
        const quantity = allocatedTo(entry.index);
        return {
          bid: entry.bid,
          allocated: quantity,
          price: quantity > 0 ? Option.map(clearing, (c) => pricing(entry.bid, c)) : Option.none(),
        };
      }),
    };
  }).pipe(Effect.withSpan("Auction.run"));

/**
 * An auction as a sealed {@link Choice.Mechanism}: bidders' bids in, the
 * allocation out.
 *
 * @since 0.1.0
 */
export const mechanism = (
  auction: Auction,
): Choice.Mechanism<Bid, Result, InvalidAuction | InvalidBid | TieBreak.TieUnresolved> => ({
  name: "Auction",
  resolve: (bids) => run(auction, bids),
});

// --- Clock auctions ----------------------------------------------------------

/**
 * A clock auction's settings: who bids, and how the price moves.
 *
 * @since 0.1.0
 */
export interface Clock {
  /** The bidders, in the order they are asked at each price. */
  readonly bidders: ReadonlyArray<Choice.ActorId>;
  /** The opening price. */
  readonly start: number;
  /** How far the price moves between calls; positive. */
  readonly step: number;
  /** For a Dutch auction, the lowest price called; for an English auction, ignored. */
  readonly floor?: number;
  /** For a Dutch auction, the units for sale. Defaults to `1`. */
  readonly supply?: number;
}

/**
 * What the auctioneer asks a bidder at the price on the clock.
 *
 * @since 0.1.0
 */
export type ClockPrompt = Data.TaggedEnum<{
  /** Dutch: will the bidder take units at this price? */
  Offer: {
    /** The price on the clock. */
    readonly price: number;
    /** The units still for sale. */
    readonly remaining: number;
    /** The units the bidder has bought so far. */
    readonly bought: number;
  };
  /** English: will the bidder stay in at this price? */
  Call: {
    /** The price on the clock. */
    readonly price: number;
    /** The bidders still in. */
    readonly active: ReadonlyArray<Choice.ActorId>;
  };
}>;

/**
 * Constructors and matchers for {@link ClockPrompt}.
 *
 * @since 0.1.0
 */
export const ClockPrompt = Data.taggedEnum<ClockPrompt>();

/**
 * A bidder's answer to a {@link ClockPrompt}.
 *
 * @since 0.1.0
 */
export type ClockResponse = Data.TaggedEnum<{
  /** Dutch: take `quantity` units at the price on the clock. */
  Take: {
    /** The units taken. */
    readonly quantity: number;
  };
  /** Dutch: wait for a lower price. English: drop out. */
  Pass: {};
  /** English: stay in at the price on the clock. */
  Stay: {};
}>;

/**
 * Constructors and matchers for {@link ClockResponse}.
 *
 * @since 0.1.0
 */
export const ClockResponse = Data.taggedEnum<ClockResponse>();

/**
 * An answer a clock auction's rules do not allow.
 *
 * @since 0.1.0
 */
export class InvalidClockResponse extends Schema.TaggedError<
  InvalidClockResponse,
  { readonly brand: unique symbol }
>()("InvalidClockResponse", {
  /** The bidder that answered. */
  bidder: Schema.String,
  /** Why the answer is not allowed. */
  reason: Schema.String,
}) {}

/**
 * A sale in a clock auction.
 *
 * @since 0.1.0
 */
export interface Sale {
  /** The buyer. */
  readonly bidder: Choice.ActorId;
  /** The units bought. */
  readonly quantity: number;
  /** The price paid per unit. */
  readonly price: number;
}

/**
 * The result of a clock auction.
 *
 * @since 0.1.0
 */
export interface ClockResult {
  /** The sales, in the order they were made. */
  readonly sales: ReadonlyArray<Sale>;
  /** The units left unsold. */
  readonly unsold: number;
}

/**
 * A Dutch auction in progress.
 *
 * @since 0.1.0
 */
export interface DutchState {
  /** The auction's settings. */
  readonly clock: Clock;
  /** The price on the clock. */
  readonly price: number;
  /** The bidder being asked, by position in {@link Clock.bidders}. */
  readonly asking: number;
  /** The units still for sale. */
  readonly remaining: number;
  /** The units taken at the current price, awaiting the end of the call. */
  readonly takes: ReadonlyArray<readonly [Choice.ActorId, number]>;
  /** The sales so far. */
  readonly sales: ReadonlyArray<Sale>;
}

/** Fills the takes at one price, whole, in an order the tie rule draws when they exceed what is left. */
const settleTakes = (state: DutchState): Effect.Effect<DutchState, TieBreak.TieUnresolved> => {
  const wanted = Arr.reduce(state.takes, 0, (sum, [, quantity]) => sum + quantity);
  const fill = (
    pool: ReadonlyArray<readonly [Choice.ActorId, number]>,
    left: number,
    sales: ReadonlyArray<Sale>,
  ): Effect.Effect<readonly [number, ReadonlyArray<Sale>], TieBreak.TieUnresolved> =>
    left <= 0 || !Arr.isReadonlyArrayNonEmpty(pool)
      ? Effect.succeed([left, sales] as const)
      : (wanted <= state.remaining
          ? Effect.succeed(pool[0])
          : TieBreak.choose(pool, `takes at ${state.price}`)
        ).pipe(
          Effect.flatMap((chosen) => {
            const quantity = Math.min(chosen[1], left);
            return fill(
              Arr.filter(pool, (take) => take !== chosen),
              left - quantity,
              Arr.append(sales, { bidder: chosen[0], quantity, price: state.price }),
            );
          }),
        );
  return fill(state.takes, state.remaining, state.sales).pipe(
    Effect.map(([remaining, sales]) => ({
      ...state,
      remaining,
      sales,
      takes: [],
      asking: 0,
      price: state.price - state.clock.step,
    })),
  );
};

/**
 * The Dutch (descending-clock) auction as a sequential {@link Choice.Protocol}:
 * the price falls by the clock's step from its start to its floor; at each
 * price every bidder is asked, in order, how many units it takes. Takes at
 * one price are filled whole, drawn by the active {@link TieBreak.TieBreak}
 * rule when they exceed what is left. Each buyer pays the price it took at.
 *
 * @since 0.1.0
 */
export const dutchProtocol: Choice.Protocol<
  DutchState,
  ClockPrompt,
  ClockResponse,
  ClockResult,
  InvalidClockResponse | TieBreak.TieUnresolved
> = {
  name: "Auction.dutch",
  next: (state) =>
    state.remaining <= 0 || state.price < (state.clock.floor ?? 0)
      ? Option.none()
      : Option.map(Arr.get(state.clock.bidders, state.asking), (actor) => ({
          actor,
          prompt: ClockPrompt.Offer({
            price: state.price,
            remaining: state.remaining,
            bought: Arr.reduce(state.sales, 0, (sum, sale) =>
              sale.bidder === actor ? sum + sale.quantity : sum,
            ),
          }),
        })),
  respond: (state, response) => {
    const bidder = state.clock.bidders[state.asking] ?? "";
    const advance = (takes: DutchState["takes"]) => {
      const next = { ...state, takes, asking: state.asking + 1 };
      return next.asking >= state.clock.bidders.length ? settleTakes(next) : Effect.succeed(next);
    };
    return ClockResponse.$match(response, {
      Take: ({ quantity }) =>
        Number.isInteger(quantity) && quantity > 0 && quantity <= state.remaining
          ? advance(Arr.append(state.takes, [Choice.ActorId(bidder), quantity] as const))
          : Effect.fail(
              new InvalidClockResponse({
                bidder,
                reason: `a take must be a whole number of units from 1 to ${state.remaining}`,
              }),
            ),
      Pass: () => advance(state.takes),
      Stay: () =>
        Effect.fail(
          new InvalidClockResponse({ bidder, reason: "a Dutch auction takes or passes" }),
        ),
    });
  },
  finish: (state) => ({ sales: state.sales, unsold: state.remaining }),
};

/**
 * Runs a Dutch auction to the end, asking `agent` each bidder's answers.
 *
 * @since 0.1.0
 */
export const dutch = <E, R>(
  clock: Clock,
  agent: Choice.Agent<ClockPrompt, ClockResponse, E, R>,
): Effect.Effect<ClockResult, InvalidClockResponse | TieBreak.TieUnresolved | E, R> =>
  Choice.play(
    dutchProtocol,
    {
      clock,
      price: clock.start,
      asking: 0,
      remaining: clock.supply ?? 1,
      takes: [],
      sales: [],
    },
    agent,
  );

/**
 * An English auction in progress.
 *
 * @since 0.1.0
 */
export interface EnglishState {
  /** The auction's settings. */
  readonly clock: Clock;
  /** The price on the clock. */
  readonly price: number;
  /** The bidders still in. */
  readonly active: ReadonlyArray<Choice.ActorId>;
  /** The active bidder being asked, by position. */
  readonly asking: number;
  /** The bidders who have stayed in at the current price. */
  readonly staying: ReadonlyArray<Choice.ActorId>;
  /** The sale, once the auction is over. */
  readonly sale: Option.Option<Sale>;
  /** Whether the auction is over. */
  readonly done: boolean;
}

const endCall = (state: EnglishState): Effect.Effect<EnglishState, TieBreak.TieUnresolved> => {
  const sold = (bidder: Choice.ActorId, price: number): EnglishState => ({
    ...state,
    sale: Option.some({ bidder, quantity: 1, price }),
    done: true,
  });
  if (state.staying.length >= 2) {
    return Effect.succeed({
      ...state,
      active: state.staying,
      staying: [],
      asking: 0,
      price: state.price + state.clock.step,
    });
  }
  return Arr.match(state.staying, {
    onNonEmpty: ([winner]) => Effect.succeed(sold(winner, state.price)),
    // Everyone dropped out: the bidders still in at the last price tie for it.
    onEmpty: () =>
      state.price === state.clock.start || !Arr.isReadonlyArrayNonEmpty(state.active)
        ? Effect.succeed({ ...state, done: true })
        : Effect.map(TieBreak.choose(state.active, `all out at ${state.price}`), (winner) =>
            sold(winner, state.price - state.clock.step),
          ),
  });
};

/**
 * The English (ascending-clock) auction for one item as a sequential
 * {@link Choice.Protocol}: the price rises by the clock's step from its
 * start; at each price every bidder still in is asked, in order, whether it
 * stays in. When one bidder is left it buys at that price. When all drop out
 * at once, those still in at the previous price tie for the item at that
 * price, settled by the active {@link TieBreak.TieBreak} rule. If nobody
 * stays in at the opening price, the item is unsold.
 *
 * @since 0.1.0
 */
export const englishProtocol: Choice.Protocol<
  EnglishState,
  ClockPrompt,
  ClockResponse,
  ClockResult,
  InvalidClockResponse | TieBreak.TieUnresolved
> = {
  name: "Auction.english",
  next: (state) =>
    state.done
      ? Option.none()
      : Option.map(Arr.get(state.active, state.asking), (actor) => ({
          actor,
          prompt: ClockPrompt.Call({ price: state.price, active: state.active }),
        })),
  respond: (state, response) => {
    const bidder = state.active[state.asking] ?? Choice.ActorId("");
    const advance = (staying: ReadonlyArray<Choice.ActorId>) => {
      const next = { ...state, staying, asking: state.asking + 1 };
      return next.asking >= state.active.length ? endCall(next) : Effect.succeed(next);
    };
    return ClockResponse.$match(response, {
      Stay: () => advance(Arr.append(state.staying, bidder)),
      Pass: () => advance(state.staying),
      Take: () =>
        Effect.fail(
          new InvalidClockResponse({ bidder, reason: "an English auction stays in or passes" }),
        ),
    });
  },
  finish: (state) => ({
    sales: Option.toArray(state.sale),
    unsold: Option.isSome(state.sale) ? 0 : 1,
  }),
};

/**
 * Runs an English auction for one item to the end, asking `agent` each
 * bidder's answers.
 *
 * @since 0.1.0
 */
export const english = <E, R>(
  clock: Clock,
  agent: Choice.Agent<ClockPrompt, ClockResponse, E, R>,
): Effect.Effect<ClockResult, InvalidClockResponse | TieBreak.TieUnresolved | E, R> =>
  Choice.play(
    englishProtocol,
    {
      clock,
      price: clock.start,
      active: clock.bidders,
      asking: 0,
      staying: [],
      sale: Option.none(),
      done: false,
    },
    agent,
  );

/**
 * A clock-auction {@link Choice.Agent} from each bidder's private value: it
 * takes (Dutch) or stays in (English) while the price is at most its value,
 * and in a Dutch auction buys `quantity(bidder)` units in all (by default 1).
 *
 * @since 0.1.0
 */
export const truthful =
  (
    value: (bidder: Choice.ActorId) => number,
    quantity: (bidder: Choice.ActorId) => number = () => 1,
  ): Choice.Agent<ClockPrompt, ClockResponse> =>
  (turn) =>
    Effect.succeed(
      ClockPrompt.$match(turn.prompt, {
        Offer: ({ price, remaining, bought }) => {
          const wanted = Math.min(quantity(turn.actor) - bought, remaining);
          return price <= value(turn.actor) && wanted > 0
            ? ClockResponse.Take({ quantity: wanted })
            : ClockResponse.Pass();
        },
        Call: ({ price }) =>
          price <= value(turn.actor) ? ClockResponse.Stay() : ClockResponse.Pass(),
      }),
    );
