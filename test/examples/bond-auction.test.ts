import { it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect } from "vite-plus/test";
import { Choice } from "@thomasfosterau/effect-choice";
import * as BondAuction from "../../examples/bond-auction.ts";

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

  it("is nothing once the bond has matured", () => {
    expect(BondAuction.price(bond, DateTime.makeUnsafe("2035-05-01"), 4)).toBe(0);
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
      const { auction, allocations } = yield* BondAuction.allocate(tender, bids);
      expect(Arr.map(allocations, (a) => a.allocated)).toEqual([400, 300, 150, 150, 0]);
      expect(auction.coverage).toBe(1.9);
      expect(auction.marginalPrice).toEqual(Option.some(4.15));
      expect(auction.allocatedAtMargin).toEqual(Option.some(30));
      expect(Option.map(auction.weightedAveragePrice, rounded)).toEqual(Option.some(4.121));
    }),
  );

  it.effect("prices each bid at its own yield under discriminatory pricing", () =>
    Effect.gen(function* () {
      const { allocations } = yield* BondAuction.allocate(tender, bids);
      const [first, , third, , fifth] = allocations;
      expect(first?.yield).toEqual(Option.some(4.1));
      expect(third?.price).toEqual(Option.some(101.132));
      expect(third?.consideration).toBe(151.7);
      expect(fifth?.price).toEqual(Option.none());
      expect(fifth?.consideration).toBe(0);
    }),
  );

  it.effect("prices every bid at the cut-off under uniform pricing", () =>
    Effect.gen(function* () {
      const { allocations } = yield* BondAuction.allocate({ ...tender, pricing: "uniform" }, bids);
      const successful = Arr.filter(allocations, (a) => a.allocated > 0);
      expect(Arr.dedupe(Arr.map(successful, (a) => a.price))).toEqual([Option.some(101.132)]);
    }),
  );

  it.effect("rejects bids and tenders that break the rules", () =>
    Effect.gen(function* () {
      const badBid = yield* Effect.flip(BondAuction.allocate(tender, [bid("A", 75, 4)]));
      expect(badBid).toMatchObject({ _tag: "InvalidBid", index: 0 });
      const badTender = yield* Effect.flip(BondAuction.allocate({ ...tender, offered: 75 }, []));
      expect(badTender._tag).toBe("InvalidAuction");
      const matured = yield* Effect.flip(
        BondAuction.allocate({ ...tender, settlement: DateTime.makeUnsafe("2035-04-21") }, []),
      );
      expect(matured._tag).toBe("InvalidTender");
    }),
  );
});
