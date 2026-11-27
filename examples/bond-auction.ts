/**
 * A Treasury Bond tender, the way the Australian Office of Financial
 * Management (AOFM) issues bonds, built on `Auction`: a sealed-bid auction
 * whose bids are yields, so a lower number is the better bid.
 *
 * - Bids are accepted from the lowest yield up until the offer is filled.
 * - Bids at the highest accepted yield (the cut-off) share what is left pro
 *   rata in whole allocation units.
 * - Under discriminatory (multiple-price) pricing, the AOFM's rule, each
 *   successful bid pays the price of its own yield; under uniform pricing,
 *   the price of the cut-off yield.
 * - Prices are per $100 face value by the Reserve Bank's Treasury Bond
 *   formula, rounded to three decimal places; consideration is to the cent.
 *
 * Not modelled: non-competitive bids, limits on bids per bidder, and the
 * issuer's discretion to scale back an issue.
 */
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Auction, type Choice, type TieBreak } from "@thomasfosterau/effect-choice";

/** A fixed-coupon bond paying interest half-yearly, on its maturity date's day of the month. */
export interface Bond {
  /** The annual coupon rate, in percent (`4.25` for 4.25 per cent). */
  readonly couponRate: number;
  /** The maturity date, which is also the last coupon date. */
  readonly maturity: DateTime.Utc;
}

/** A tender: what the issuer offers, and how it prices it. */
export interface Tender {
  readonly bond: Bond;
  /** The settlement date, at which prices are calculated. */
  readonly settlement: DateTime.Utc;
  /** The face value on offer. */
  readonly offered: number;
  readonly pricing: "discriminatory" | "uniform";
  /** The allocation unit: bids and allocations are whole multiples of it. Defaults to `1`. */
  readonly unit?: number;
}

/** One sealed bid. */
export interface Bid {
  readonly bidder: Choice.ActorId;
  /** The face value bid for. */
  readonly faceValue: number;
  /** The yield bid, in percent per annum. */
  readonly yield: number;
}

/** What one bid was allocated, and what it pays. */
export interface Allocation {
  readonly bid: Bid;
  /** The face value allocated, possibly zero. */
  readonly allocated: number;
  /** The yield the allocation is priced at, if anything was allocated. */
  readonly yield: Option.Option<number>;
  /** The price per $100 face value at that yield. */
  readonly price: Option.Option<number>;
  /** What the bidder pays, to the cent. */
  readonly consideration: number;
}

/** The result of a tender. */
export interface Result {
  readonly auction: Auction.Result;
  readonly allocations: ReadonlyArray<Allocation>;
}

/** A tender that cannot be run. */
export class InvalidTender extends Schema.TaggedError<
  InvalidTender,
  { readonly brand: unique symbol }
>()("InvalidTender", { reason: Schema.String }) {}

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

/** The tender's rules as a generic sealed-bid {@link Auction.Auction}. */
export const toAuction = (tender: Tender): Auction.Auction => ({
  supply: tender.offered,
  better: "Lowest",
  rationing: "ProRata",
  pricing: tender.pricing === "uniform" ? Auction.uniform : Auction.payAsBid,
  unit: tender.unit ?? 1,
});

/** Runs a tender: allocates by yield, then prices each allocation. */
export const allocate = (
  tender: Tender,
  bids: ReadonlyArray<Bid>,
): Effect.Effect<
  Result,
  InvalidTender | Auction.InvalidAuction | Auction.InvalidBid | TieBreak.TieUnresolved
> =>
  Effect.gen(function* () {
    if (!DateTime.isLessThan(tender.settlement, tender.bond.maturity)) {
      return yield* new InvalidTender({ reason: "the bond matures on or before settlement" });
    }
    const auction = yield* Auction.run(
      toAuction(tender),
      Arr.map(bids, (bid) => ({ bidder: bid.bidder, quantity: bid.faceValue, price: bid.yield })),
    );
    return {
      auction,
      allocations: Arr.zipWith(bids, auction.allocations, (bid, allocation): Allocation => {
        const unitPrice = Option.map(allocation.price, (y) =>
          round(price(tender.bond, tender.settlement, y), 3),
        );
        return {
          bid,
          allocated: allocation.allocated,
          yield: allocation.price,
          price: unitPrice,
          consideration: Option.match(unitPrice, {
            onNone: () => 0,
            onSome: (p) => round((allocation.allocated * p) / 100, 2),
          }),
        };
      }),
    };
  }).pipe(Effect.withSpan("BondAuction.allocate"));
