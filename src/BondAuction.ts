/**
 * Sealed-bid yield tenders for fixed-coupon government bonds, as the
 * Australian Office of Financial Management (AOFM) runs them for Treasury
 * Bonds.
 *
 * Bidders (actors) each submit sealed bids of a face value at a yield. The
 * issuer accepts bids from the lowest yield (the highest price) up until the
 * amount on offer is filled:
 *
 * - Bids below the **cut-off yield** (the highest accepted yield) are
 *   allocated in full.
 * - Bids at the cut-off share what is left **pro rata** to their face value,
 *   in whole allocation units; units left over by rounding go one each to the
 *   largest remainders, with ties settled by the active
 *   {@link TieBreak.TieBreak} rule.
 * - Under **discriminatory** (multiple-price) pricing, the AOFM's rule, each
 *   successful bid pays the price of its own yield. Under **uniform**
 *   pricing every successful bid pays the price of the cut-off yield.
 *
 * Prices are per $100 face value, from the Reserve Bank's Treasury Bond
 * pricing formula, rounded to three decimal places; a bid's consideration is
 * rounded to the cent.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import type * as Choice from "./Choice.ts";
import * as TieBreak from "./TieBreak.ts";

/**
 * A fixed-coupon bond paying interest half-yearly, on its maturity date's day
 * of the month every six months.
 *
 * @since 0.1.0
 */
export interface Bond {
  /** The annual coupon rate, in percent (`4.25` for 4.25 per cent). */
  readonly couponRate: number;
  /** The maturity date, which is also the last coupon date. */
  readonly maturity: DateTime.Utc;
}

/**
 * How successful bids are priced.
 *
 * @since 0.1.0
 */
export type Pricing = "discriminatory" | "uniform";

/**
 * A tender: what the issuer offers, and how it allocates and prices it.
 *
 * @since 0.1.0
 */
export interface Tender {
  /** The bond on offer. */
  readonly bond: Bond;
  /** The settlement date, at which prices are calculated. */
  readonly settlement: DateTime.Utc;
  /** The face value on offer. */
  readonly offered: number;
  /** How successful bids are priced. */
  readonly pricing: Pricing;
  /** The allocation unit: bids and allocations are whole multiples of it. Defaults to `1`. */
  readonly unit?: number;
  /** The smallest face value a bid may be for. Defaults to one unit. */
  readonly minimumBid?: number;
}

/**
 * One sealed bid.
 *
 * @since 0.1.0
 */
export interface Bid {
  /** Who made the bid. */
  readonly bidder: Choice.ActorId;
  /** The face value bid for. */
  readonly faceValue: number;
  /** The yield bid, in percent per annum. */
  readonly yield: number;
}

/**
 * What one bid was allocated, and what it pays.
 *
 * @since 0.1.0
 */
export interface Allocation {
  /** The bid. */
  readonly bid: Bid;
  /** The face value allocated, possibly zero. */
  readonly allocated: number;
  /** The yield the allocation is priced at: the bid's own, or the cut-off under uniform pricing. */
  readonly yield: number;
  /** The price per $100 face value at that yield. */
  readonly price: number;
  /** What the bidder pays for the allocation, to the cent. */
  readonly consideration: number;
}

/**
 * The result of a tender.
 *
 * @since 0.1.0
 */
export interface Result {
  /** The face value on offer. */
  readonly offered: number;
  /** The face value allocated: the amount on offer, unless the tender was undersubscribed. */
  readonly allocated: number;
  /** The total face value bid for. */
  readonly bidFor: number;
  /** The coverage ratio: total bids over the amount on offer. */
  readonly coverage: number;
  /** The highest accepted yield, if any bid succeeded. */
  readonly cutoffYield: Option.Option<number>;
  /** The share of the face value bid at the cut-off yield that was allocated, in percent. */
  readonly allocatedAtCutoff: Option.Option<number>;
  /** The average yield of the successful bids, weighted by allocation. */
  readonly weightedAverageYield: Option.Option<number>;
  /** Each bid's allocation, in the order the bids were submitted. */
  readonly allocations: ReadonlyArray<Allocation>;
}

/**
 * A tender that cannot be run.
 *
 * @since 0.1.0
 */
export class InvalidTender extends Schema.TaggedError<
  InvalidTender,
  { readonly brand: unique symbol }
>()("InvalidTender", {
  /** Why the tender cannot be run. */
  reason: Schema.String,
}) {}

/**
 * A bid the tender's rules reject.
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

// --- Pricing -----------------------------------------------------------------

const days = (from: DateTime.Utc, to: DateTime.Utc): number =>
  Math.round(Duration.toDays(DateTime.distance(from, to)));

/** The coupon dates strictly after `settlement`, latest (maturity) first, and the coupon date on or before it. */
interface Schedule {
  /** The coupon dates after settlement, maturity first. */
  readonly future: ReadonlyArray<DateTime.Utc>;
  /** The coupon date on or before settlement. */
  readonly previous: DateTime.Utc;
}

const schedule = (bond: Bond, settlement: DateTime.Utc): Schedule => {
  const dates = Arr.unfold(0, (k) => {
    const date = DateTime.subtract(bond.maturity, { months: 6 * k });
    return DateTime.isGreaterThan(date, settlement) ? Option.some([date, k + 1]) : Option.none();
  });
  return {
    future: dates,
    previous: DateTime.subtract(bond.maturity, { months: 6 * dates.length }),
  };
};

/**
 * The price per $100 face value of `bond` at `yieldRate` (percent per annum)
 * for settlement on `settlement`, by the Reserve Bank's Treasury Bond formula,
 * unrounded:
 *
 * `P = v^(f/d) × (g × (c + aₙ) + 100 × vⁿ)`
 *
 * where `i` is the half-yearly yield, `v = 1 / (1 + i)`, `f` is the days from
 * settlement to the next coupon, `d` the days in the half-year ending then,
 * `g` the half-yearly coupon per $100, `n` the full half-years from the next
 * coupon to maturity, `aₙ = (1 − vⁿ) / i`, and `c` is 0 when the bond trades
 * ex-interest (settlement within seven days of the next coupon) and 1
 * otherwise. A bond settling on or after its maturity is priced at 0.
 *
 * @since 0.1.0
 */
export const price = (bond: Bond, settlement: DateTime.Utc, yieldRate: number): number => {
  const { future, previous } = schedule(bond, settlement);
  return Option.match(Arr.last(future), {
    onNone: () => 0,
    onSome: (next) => {
      const i = yieldRate / 200;
      const v = 1 / (1 + i);
      const f = days(settlement, next);
      const d = days(previous, next);
      const n = future.length - 1;
      const g = bond.couponRate / 2;
      const c = f <= 7 ? 0 : 1;
      const annuity = i === 0 ? n : (1 - v ** n) / i;
      return v ** (f / d) * (g * (c + annuity) + 100 * v ** n);
    },
  });
};

const round = (value: number, places: number): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

// --- Allocation --------------------------------------------------------------

interface Entry {
  readonly index: number;
  readonly bid: Bid;
}

const validate = (
  tender: Tender,
  unit: number,
  bids: ReadonlyArray<Bid>,
): Effect.Effect<void, InvalidTender | InvalidBid> => {
  const minimum = tender.minimumBid ?? unit;
  const isMultiple = (value: number) => Number.isInteger(value / unit);
  if (!(unit > 0) || !(tender.offered > 0) || !isMultiple(tender.offered)) {
    return Effect.fail(
      new InvalidTender({ reason: "the offer must be a positive whole number of units" }),
    );
  }
  if (!DateTime.isLessThan(tender.settlement, tender.bond.maturity)) {
    return Effect.fail(new InvalidTender({ reason: "settlement must be before maturity" }));
  }
  return Effect.forEach(
    bids,
    (bid, index) =>
      !Number.isFinite(bid.yield)
        ? Effect.fail(new InvalidBid({ index, reason: "the yield must be a finite number" }))
        : bid.faceValue < minimum || !isMultiple(bid.faceValue)
          ? Effect.fail(
              new InvalidBid({
                index,
                reason: `the face value must be a whole number of units of ${unit}, at least ${minimum}`,
              }),
            )
          : Effect.void,
    { discard: true, concurrency: 1 },
  );
};

/**
 * Shares `amount` (a whole number of units) among `entries` pro rata to their
 * face values, giving units left over by rounding to the largest remainders.
 */
const proRata = (
  entries: Arr.NonEmptyReadonlyArray<Entry>,
  amount: number,
  unit: number,
): Effect.Effect<ReadonlyArray<readonly [number, number]>, TieBreak.TieUnresolved> => {
  const total = Arr.reduce(entries, 0, (sum, entry) => sum + entry.bid.faceValue);
  const shares = Arr.map(entries, (entry) => {
    const exact = (entry.bid.faceValue * amount) / total / unit;
    return { entry, units: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  const leftover = Math.round(amount / unit - Arr.reduce(shares, 0, (sum, s) => sum + s.units));
  type Share = (typeof shares)[number];
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
    return TieBreak.choose(tied, "rounding at the cut-off yield").pipe(
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
      Arr.map(
        shares,
        (s) =>
          [
            s.entry.index,
            (s.units + (Arr.contains(awarded, s.entry.index) ? 1 : 0)) * unit,
          ] as const,
      ),
    ),
  );
};

/**
 * Runs `tender` on `bids`.
 *
 * Fails with {@link InvalidTender} or {@link InvalidBid} when the tender or a
 * bid breaks the rules, and with {@link TieBreak.TieUnresolved} when a
 * rounding tie at the cut-off reaches a tie rule that refuses it.
 *
 * @since 0.1.0
 */
export const allocate = (
  tender: Tender,
  bids: ReadonlyArray<Bid>,
): Effect.Effect<Result, InvalidTender | InvalidBid | TieBreak.TieUnresolved> =>
  Effect.gen(function* () {
    const unit = tender.unit ?? 1;
    yield* validate(tender, unit, bids);
    const entries = Arr.map(bids, (bid, index): Entry => ({ index, bid }));
    const levels = Arr.dedupe(
      Arr.sort(
        Arr.map(bids, (bid) => bid.yield),
        Order.Number,
      ),
    );
    interface Filling {
      readonly remaining: number;
      readonly awards: ReadonlyArray<readonly [number, number]>;
    }
    const filled = yield* Effect.reduce(
      levels,
      (): Filling => ({ remaining: tender.offered, awards: [] }),
      (state: Filling, level: number): Effect.Effect<Filling, TieBreak.TieUnresolved> => {
        const atLevel = Arr.filter(entries, (entry) => entry.bid.yield === level);
        const wanted = Arr.reduce(atLevel, 0, (sum, entry) => sum + entry.bid.faceValue);
        if (state.remaining <= 0 || !Arr.isReadonlyArrayNonEmpty(atLevel)) {
          return Effect.succeed(state);
        }
        if (wanted <= state.remaining) {
          return Effect.succeed({
            remaining: state.remaining - wanted,
            awards: Arr.appendAll(
              state.awards,
              Arr.map(atLevel, (entry) => [entry.index, entry.bid.faceValue] as const),
            ),
          });
        }
        return proRata(atLevel, state.remaining, unit).pipe(
          Effect.map((awards) => ({ remaining: 0, awards: Arr.appendAll(state.awards, awards) })),
        );
      },
    );
    const allocatedTo = (index: number) =>
      Option.getOrElse(
        Option.map(
          Arr.findFirst(filled.awards, ([i]) => i === index),
          ([, amount]) => amount,
        ),
        () => 0,
      );
    const successful = Arr.filter(entries, (entry) => allocatedTo(entry.index) > 0);
    const cutoffYield = Arr.match(successful, {
      onEmpty: () => Option.none<number>(),
      onNonEmpty: (all) => Option.some(Math.max(...Arr.map(all, (entry) => entry.bid.yield))),
    });
    const allocated = tender.offered - filled.remaining;
    const allocations = Arr.map(entries, (entry): Allocation => {
      const amount = allocatedTo(entry.index);
      const paidYield =
        tender.pricing === "uniform"
          ? Option.getOrElse(cutoffYield, () => entry.bid.yield)
          : entry.bid.yield;
      const unitPrice = round(price(tender.bond, tender.settlement, paidYield), 3);
      return {
        bid: entry.bid,
        allocated: amount,
        yield: paidYield,
        price: unitPrice,
        consideration: round((amount * unitPrice) / 100, 2),
      };
    });
    const bidFor = Arr.reduce(bids, 0, (sum, bid) => sum + bid.faceValue);
    return {
      offered: tender.offered,
      allocated,
      bidFor,
      coverage: bidFor / tender.offered,
      cutoffYield,
      allocatedAtCutoff: Option.map(cutoffYield, (cutoff) => {
        const atCutoff = Arr.filter(entries, (entry) => entry.bid.yield === cutoff);
        const bid = Arr.reduce(atCutoff, 0, (sum, entry) => sum + entry.bid.faceValue);
        const got = Arr.reduce(atCutoff, 0, (sum, entry) => sum + allocatedTo(entry.index));
        return (got / bid) * 100;
      }),
      weightedAverageYield:
        allocated > 0
          ? Option.some(
              Arr.reduce(
                successful,
                0,
                (sum, entry) => sum + allocatedTo(entry.index) * entry.bid.yield,
              ) / allocated,
            )
          : Option.none(),
      allocations,
    };
  }).pipe(Effect.withSpan("BondAuction.allocate"));

/**
 * A tender as a sealed {@link Choice.Mechanism}: bidders' bids in, the
 * allocation out.
 *
 * @since 0.1.0
 */
export const mechanism = (
  tender: Tender,
): Choice.Mechanism<Bid, Result, InvalidTender | InvalidBid | TieBreak.TieUnresolved> => ({
  name: "BondAuction",
  resolve: (bids) => allocate(tender, bids),
});
