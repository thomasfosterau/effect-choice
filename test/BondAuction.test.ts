import { it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect } from "vite-plus/test";
import { BondAuction, Choice, TieBreak } from "../src/index.ts";

const bond: BondAuction.Bond = {
  couponRate: 4.25,
  maturity: DateTime.makeUnsafe("2035-04-21"),
};
const settlement = DateTime.makeUnsafe("2026-11-27");
const bid = (bidder: string, faceValue: number, yieldRate: number): BondAuction.Bid => ({
  bidder: Choice.ActorId(bidder),
  faceValue,
  yield: yieldRate,
});
const rounded = (value: number) => Math.round(value * 1000) / 1000;

describe("price", () => {
  it("is par on a coupon date when the yield equals the coupon", () => {
    expect(rounded(BondAuction.price(bond, DateTime.makeUnsafe("2026-10-21"), 4.25))).toBe(100);
  });

  it("falls as the yield rises", () => {
    expect(rounded(BondAuction.price(bond, settlement, 4.15))).toBe(101.132);
    expect(rounded(BondAuction.price(bond, settlement, 4.4))).toBe(99.385);
  });

  it("drops the next coupon inside the ex-interest period", () => {
    // Five days before the 21 April 2027 coupon.
    const ex = BondAuction.price(bond, DateTime.makeUnsafe("2027-04-16"), 4.4);
    const cum = BondAuction.price(bond, DateTime.makeUnsafe("2027-04-13"), 4.4);
    expect(rounded(ex)).toBe(98.938);
    expect(cum - ex).toBeGreaterThan(2);
  });
});

describe("allocate", () => {
  const tender: BondAuction.Tender = {
    bond,
    settlement,
    offered: 1000,
    pricing: "discriminatory",
    unit: 50,
  };
  const bids = [
    bid("A", 400, 4.1),
    bid("B", 300, 4.12),
    bid("C", 500, 4.15),
    bid("D", 500, 4.15),
    bid("E", 200, 4.2),
  ];

  it.effect("fills from the lowest yield and shares the cut-off pro rata", () =>
    Effect.gen(function* () {
      const result = yield* BondAuction.allocate(tender, bids);
      expect(Arr.map(result.allocations, (a) => a.allocated)).toEqual([400, 300, 150, 150, 0]);
      expect(result.allocated).toBe(1000);
      expect(result.coverage).toBe(1.9);
      expect(result.cutoffYield).toEqual(Option.some(4.15));
      expect(result.allocatedAtCutoff).toEqual(Option.some(30));
      expect(Option.map(result.weightedAverageYield, rounded)).toEqual(Option.some(4.121));
    }),
  );

  it.effect("prices each bid at its own yield under discriminatory pricing", () =>
    Effect.gen(function* () {
      const result = yield* BondAuction.allocate(tender, bids);
      const [first, , third] = result.allocations;
      expect(first?.yield).toBe(4.1);
      expect(third?.yield).toBe(4.15);
      expect(third?.price).toBe(101.132);
      expect(third?.consideration).toBe(151.7);
      expect(first?.price).toBeGreaterThan(third?.price ?? Infinity);
    }),
  );

  it.effect("prices every bid at the cut-off under uniform pricing", () =>
    Effect.gen(function* () {
      const result = yield* BondAuction.allocate({ ...tender, pricing: "uniform" }, bids);
      const successful = Arr.filter(result.allocations, (a) => a.allocated > 0);
      expect(Arr.dedupe(Arr.map(successful, (a) => a.price))).toEqual([101.132]);
      expect(Arr.dedupe(Arr.map(successful, (a) => a.yield))).toEqual([4.15]);
    }),
  );

  it.effect("gives rounding units to the largest remainders, ties by the tie rule", () =>
    Effect.gen(function* () {
      const tied = { ...tender, offered: 200, unit: 100 };
      const three = [bid("A", 100, 4), bid("B", 100, 4), bid("C", 100, 4)];
      const result = yield* BondAuction.allocate(tied, three).pipe(
        Effect.provideService(TieBreak.TieBreak, TieBreak.first),
      );
      expect(Arr.map(result.allocations, (a) => a.allocated)).toEqual([100, 100, 0]);
      const uneven = yield* BondAuction.allocate({ ...tied, offered: 300 }, [
        bid("A", 300, 4),
        bid("B", 200, 4),
        bid("C", 200, 4),
        bid("D", 100, 4),
      ]).pipe(Effect.provideService(TieBreak.TieBreak, TieBreak.refuse));
      // Exact shares of 1.125, 0.75, 0.75 and 0.375 units: A's one unit,
      // then the two left over to B and C, the largest remainders, in turn.
      expect(Arr.map(uneven.allocations, (a) => a.allocated)).toEqual([100, 100, 100, 0]);
      const refused = yield* BondAuction.allocate(tied, three).pipe(
        Effect.provideService(TieBreak.TieBreak, TieBreak.refuse),
        Effect.flip,
      );
      expect(refused._tag).toBe("TieUnresolved");
    }),
  );

  it.effect("allocates everything bid when undersubscribed", () =>
    Effect.gen(function* () {
      const result = yield* BondAuction.allocate(tender, [bid("A", 300, 4.1), bid("B", 200, 4.3)]);
      expect(result.allocated).toBe(500);
      expect(result.coverage).toBe(0.5);
      expect(result.cutoffYield).toEqual(Option.some(4.3));
    }),
  );

  it.effect("rejects bids and tenders that break the rules", () =>
    Effect.gen(function* () {
      const badBid = yield* Effect.flip(BondAuction.allocate(tender, [bid("A", 75, 4)]));
      expect(badBid).toMatchObject({ _tag: "InvalidBid", index: 0 });
      const badYield = yield* Effect.flip(
        BondAuction.allocate(tender, [bid("A", 50, 4), bid("B", 50, Number.NaN)]),
      );
      expect(badYield).toMatchObject({ _tag: "InvalidBid", index: 1 });
      const badTender = yield* Effect.flip(BondAuction.allocate({ ...tender, offered: 75 }, []));
      expect(badTender._tag).toBe("InvalidTender");
      const matured = yield* Effect.flip(
        BondAuction.allocate({ ...tender, settlement: DateTime.makeUnsafe("2035-04-21") }, []),
      );
      expect(matured._tag).toBe("InvalidTender");
    }),
  );
});

describe("mechanism", () => {
  it.effect("asks every bidder for a bid and runs the tender", () =>
    Effect.gen(function* () {
      const bidders = Arr.map(["A", "B", "C"], Choice.ActorId);
      const result = yield* Choice.run(
        BondAuction.mechanism({ bond, settlement, offered: 200, pricing: "uniform" }),
        bidders,
        "bid",
        ({ actor }) => Effect.succeed(bid(actor, 100, actor === "C" ? 4.5 : 4.2)),
      );
      expect(Arr.map(result.allocations, (a) => a.allocated)).toEqual([100, 100, 0]);
    }),
  );
});
