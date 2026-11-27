import { it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect } from "vite-plus/test";
import { Auction, Choice, TieBreak } from "../src/index.ts";

const [A, B, C] = Arr.map(["A", "B", "C"], Choice.ActorId);
const bid = (bidder: Choice.ActorId, quantity: number, price: number): Auction.Bid => ({
  bidder,
  quantity,
  price,
});
const allocated = (result: Auction.Result) => Arr.map(result.allocations, (a) => a.allocated);
const prices = (result: Auction.Result) => Arr.map(result.allocations, (a) => a.price);

describe("run", () => {
  // Three units: A's two at 10 fill first, then B's two at 8 share the one left.
  const bids = [bid(A, 2, 10), bid(B, 2, 8), bid(C, 1, 6)];

  it.effect("fills the best bids first and prices each at its own bid", () =>
    Effect.gen(function* () {
      const result = yield* Auction.run({ supply: 3 }, bids);
      expect(allocated(result)).toEqual([2, 1, 0]);
      expect(prices(result)).toEqual([Option.some(10), Option.some(8), Option.none()]);
      expect(result.marginalPrice).toEqual(Option.some(8));
      expect(result.allocatedAtMargin).toEqual(Option.some(50));
      expect(Option.map(result.weightedAveragePrice, (p) => Math.round(p * 100) / 100)).toEqual(
        Option.some(9.33),
      );
      expect(result.coverage).toBeCloseTo(5 / 3);
    }),
  );

  it.effect("prices every successful bid at the margin under uniform pricing", () =>
    Effect.gen(function* () {
      const result = yield* Auction.run({ supply: 3, pricing: Auction.uniform }, bids);
      expect(prices(result)).toEqual([Option.some(8), Option.some(8), Option.none()]);
    }),
  );

  it.effect("prices at the best rejected bid under first-rejected pricing", () =>
    Effect.gen(function* () {
      const vickrey = yield* Auction.run({ supply: 1, pricing: Auction.firstRejected }, [
        bid(A, 1, 120),
        bid(B, 1, 100),
      ]);
      expect(prices(vickrey)).toEqual([Option.some(100), Option.none()]);
      // A bid below the reserve never competed, so the winner pays the reserve.
      const reserved = yield* Auction.run(
        { supply: 1, pricing: Auction.firstRejected, reserve: 110 },
        [bid(A, 1, 120), bid(B, 1, 100)],
      );
      expect(prices(reserved)).toEqual([Option.some(110), Option.none()]);
    }),
  );

  it.effect("rejects bids worse than the reserve", () =>
    Effect.gen(function* () {
      const result = yield* Auction.run({ supply: 3, reserve: 9 }, bids);
      expect(allocated(result)).toEqual([2, 0, 0]);
      expect(result.allocated).toBe(2);
      const lowest = yield* Auction.run({ supply: 3, better: "Lowest", reserve: 8 }, bids);
      // Lower is better: C's 6 fills first, then B's 8; A's 10 is over the reserve.
      expect(allocated(lowest)).toEqual([0, 2, 1]);
    }),
  );

  it.effect("fills marginal bids whole by lot when asked", () =>
    Effect.gen(function* () {
      const result = yield* Auction.run({ supply: 2, rationing: "ByLot" }, [
        bid(A, 2, 5),
        bid(B, 2, 5),
      ]).pipe(Effect.provideService(TieBreak.TieBreak, TieBreak.first));
      expect(allocated(result)).toEqual([2, 0]);
      const refused = yield* Auction.run({ supply: 2, rationing: "ByLot" }, [
        bid(A, 2, 5),
        bid(B, 2, 5),
      ]).pipe(Effect.provideService(TieBreak.TieBreak, TieBreak.refuse), Effect.flip);
      expect(refused._tag).toBe("TieUnresolved");
    }),
  );

  it.effect("shares the margin pro rata in whole units, ties to the tie rule", () =>
    Effect.gen(function* () {
      const tied = [bid(A, 100, 4), bid(B, 100, 4), bid(C, 100, 4)];
      const first = yield* Auction.run({ supply: 200, unit: 100 }, tied).pipe(
        Effect.provideService(TieBreak.TieBreak, TieBreak.first),
      );
      expect(allocated(first)).toEqual([100, 100, 0]);
      // Exact shares of 1.125, 0.75, 0.75 and 0.375 units: A's one unit,
      // then the two left over to B and C, the largest remainders.
      const uneven = yield* Auction.run({ supply: 300, unit: 100 }, [
        bid(A, 300, 4),
        bid(B, 200, 4),
        bid(C, 200, 4),
        bid(A, 100, 4),
      ]).pipe(Effect.provideService(TieBreak.TieBreak, TieBreak.refuse));
      expect(allocated(uneven)).toEqual([100, 100, 100, 0]);
    }),
  );

  it.effect("allocates everything bid when undersubscribed", () =>
    Effect.gen(function* () {
      const result = yield* Auction.run({ supply: 10 }, bids);
      expect(result.allocated).toBe(5);
      expect(result.coverage).toBe(0.5);
      const empty = yield* Auction.run({ supply: 10 }, []);
      expect(empty.marginalPrice).toEqual(Option.none());
      expect(empty.weightedAveragePrice).toEqual(Option.none());
    }),
  );

  it.effect("rejects auctions and bids that break the rules", () =>
    Effect.gen(function* () {
      const supply = yield* Effect.flip(Auction.run({ supply: 0 }, []));
      expect(supply._tag).toBe("InvalidAuction");
      const unit = yield* Effect.flip(Auction.run({ supply: 10, unit: 5 }, [bid(A, 7, 1)]));
      expect(unit).toMatchObject({ _tag: "InvalidBid", index: 0 });
      const price = yield* Effect.flip(Auction.run({ supply: 10 }, [bid(A, 1, 1), bid(B, 1, NaN)]));
      expect(price).toMatchObject({ _tag: "InvalidBid", index: 1 });
      const minimum = yield* Effect.flip(
        Auction.run({ supply: 10, minimumBid: 2 }, [bid(A, 1, 1)]),
      );
      expect(minimum._tag).toBe("InvalidBid");
    }),
  );
});

describe("mechanism", () => {
  it.effect("asks every bidder for a sealed bid", () =>
    Effect.gen(function* () {
      const result = yield* Choice.run(
        Auction.mechanism({ supply: 1, pricing: Auction.firstRejected }),
        [A, B, C],
        "bid",
        ({ actor }) => Effect.succeed(bid(actor, 1, actor === B ? 90 : 50)),
      );
      expect(allocated(result)).toEqual([0, 1, 0]);
      expect(prices(result)[1]).toEqual(Option.some(50));
    }),
  );
});

// A values the item at 75, B at 95 and C at 60.
const truthful = Auction.truthful((bidder) => (bidder === A ? 75 : bidder === B ? 95 : 60));

describe("dutch", () => {
  const clock: Auction.Clock = { bidders: [A, B, C], start: 100, step: 10, floor: 50, supply: 2 };

  it.effect("sells to each bidder as the price falls to its value", () =>
    Effect.gen(function* () {
      const result = yield* Auction.dutch(clock, truthful);
      expect(result).toEqual({
        sales: [
          { bidder: B, quantity: 1, price: 90 },
          { bidder: A, quantity: 1, price: 70 },
        ],
        unsold: 0,
      });
    }),
  );

  it.effect("leaves the supply unsold when the floor is reached", () =>
    Effect.gen(function* () {
      const result = yield* Auction.dutch({ ...clock, floor: 80, supply: 3 }, truthful);
      expect(result.sales).toEqual([{ bidder: B, quantity: 1, price: 90 }]);
      expect(result.unsold).toBe(2);
    }),
  );

  it.effect("draws between takes at one price that exceed the supply", () =>
    Effect.gen(function* () {
      const twins = Auction.truthful(() => 95);
      const first = yield* Auction.dutch({ ...clock, supply: 1 }, twins).pipe(
        Effect.provideService(TieBreak.TieBreak, TieBreak.first),
      );
      expect(first.sales).toEqual([{ bidder: A, quantity: 1, price: 90 }]);
      const refused = yield* Auction.dutch({ ...clock, supply: 1 }, twins).pipe(
        Effect.provideService(TieBreak.TieBreak, TieBreak.refuse),
        Effect.flip,
      );
      expect(refused._tag).toBe("TieUnresolved");
    }),
  );

  it.effect("fills a large take partly when it is drawn last", () =>
    Effect.gen(function* () {
      const result = yield* Auction.dutch(
        { ...clock, supply: 3 },
        Auction.truthful(
          () => 95,
          () => 2,
        ),
      ).pipe(Effect.provideService(TieBreak.TieBreak, TieBreak.first));
      expect(result.sales).toEqual([
        { bidder: A, quantity: 2, price: 90 },
        { bidder: B, quantity: 1, price: 90 },
      ]);
    }),
  );

  it.effect("rejects answers a Dutch auction does not allow", () =>
    Effect.gen(function* () {
      const stay = yield* Effect.flip(
        Auction.dutch(clock, () => Effect.succeed(Auction.ClockResponse.Stay())),
      );
      expect(stay).toMatchObject({ _tag: "InvalidClockResponse", bidder: A });
      const tooMany = yield* Effect.flip(
        Auction.dutch(clock, () => Effect.succeed(Auction.ClockResponse.Take({ quantity: 3 }))),
      );
      expect(tooMany._tag).toBe("InvalidClockResponse");
    }),
  );
});

describe("english", () => {
  const clock: Auction.Clock = { bidders: [A, B, C], start: 50, step: 10 };

  it.effect("sells to the last bidder in at the price it was left alone at", () =>
    Effect.gen(function* () {
      // C drops out at 70, A at 80; B is alone at 80.
      const result = yield* Auction.english(clock, truthful);
      expect(result).toEqual({ sales: [{ bidder: B, quantity: 1, price: 80 }], unsold: 0 });
    }),
  );

  it.effect("draws between bidders who all drop out at once, at the last price they held", () =>
    Effect.gen(function* () {
      const twins = Auction.truthful((bidder) => (bidder === C ? 0 : 75));
      const result = yield* Auction.english(clock, twins).pipe(
        Effect.provideService(TieBreak.TieBreak, TieBreak.first),
      );
      expect(result.sales).toEqual([{ bidder: A, quantity: 1, price: 70 }]);
    }),
  );

  it.effect("leaves the item unsold when nobody opens", () =>
    Effect.gen(function* () {
      const result = yield* Auction.english(
        clock,
        Auction.truthful(() => 10),
      );
      expect(result).toEqual({ sales: [], unsold: 1 });
    }),
  );

  it.effect("rejects answers an English auction does not allow", () =>
    Effect.gen(function* () {
      const take = yield* Effect.flip(
        Auction.english(clock, () => Effect.succeed(Auction.ClockResponse.Take({ quantity: 1 }))),
      );
      expect(take).toMatchObject({ _tag: "InvalidClockResponse", bidder: A });
    }),
  );
});
