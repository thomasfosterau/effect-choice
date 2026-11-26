import { it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect } from "vite-plus/test";
import { AflDraft, Choice } from "../src/index.ts";

const [A, B, C, D, E, F, G, H, I, J] = Arr.map(
  ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
  Choice.ActorId,
);
const players = Arr.map(Arr.range(1, 50), (n) => Choice.AlternativeId(`p${n}`));
const player = (n: number) => Choice.AlternativeId(`p${n}`);

// A ten-club league: A to H make the finals, and G wins the flag from seventh.
const season: AflDraft.Season = {
  ladder: [A, B, C, D, E, F, G, H, I, J],
  eliminationFinalLosers: [F, H],
  semiFinalLosers: [D, E],
  preliminaryFinalLosers: [B, C],
  runnerUp: A,
  premier: G,
};
const order = [J, I, H, F, E, D, C, B, A, G];
const bigBoard = AflDraft.byRanking(() => players);

describe("draftOrder", () => {
  it.effect("puts non-finalists first, then finalists by the week they went out", () =>
    Effect.gen(function* () {
      expect(yield* AflDraft.draftOrder(season)).toEqual(order);
    }),
  );

  it.effect("rejects an inconsistent season", () =>
    Effect.gen(function* () {
      const twice = yield* Effect.flip(AflDraft.draftOrder({ ...season, semiFinalLosers: [D, F] }));
      expect(twice._tag).toBe("InvalidDraft");
      const missing = yield* Effect.flip(
        AflDraft.draftOrder({ ...season, ladder: Arr.drop(season.ladder, 1) }),
      );
      expect(missing._tag).toBe("InvalidDraft");
    }),
  );
});

describe("draftValueIndex", () => {
  it("values picks from 3,000 down to nothing", () => {
    expect(AflDraft.draftValueIndex(1)).toBe(3000);
    expect(AflDraft.draftValueIndex(18)).toBe(985);
    expect(AflDraft.draftValueIndex(73)).toBe(9);
    expect(AflDraft.draftValueIndex(74)).toBe(0);
  });
});

describe("run", () => {
  const draft: AflDraft.Draft = {
    order,
    rounds: 4,
    players,
    priorityPicks: [{ club: I, placement: "StartOfFirstRound" }],
    trades: [{ round: 1, originalClub: H, club: B }],
    nominations: [{ player: player(3), club: A, kind: "Academy" }],
  };

  it.effect("runs priority and traded picks in order", () =>
    Effect.gen(function* () {
      const result = yield* AflDraft.run({ ...draft, nominations: [] }, bigBoard);
      expect(Arr.map(Arr.take(result.selections, 12), (s) => s.club)).toEqual([
        I,
        J,
        I,
        B,
        F,
        E,
        D,
        C,
        B,
        A,
        G,
        J,
      ]);
      expect(result.selections).toHaveLength(41);
      expect(result.undrafted).toHaveLength(9);
    }),
  );

  it.effect("lets the nominating club match a bid and pay for it in points", () =>
    Effect.gen(function* () {
      const result = yield* AflDraft.run(draft, bigBoard);
      // I bids on A's academy player with pick 3; A matches, and I picks again.
      expect(Arr.take(result.selections, 4)).toEqual([
        { number: 1, round: 1, club: I, player: player(1), matchedBidBy: Option.none() },
        { number: 2, round: 1, club: J, player: player(2), matchedBidBy: Option.none() },
        { number: 3, round: 1, club: A, player: player(3), matchedBidBy: Option.some(I) },
        { number: 4, round: 1, club: I, player: player(4), matchedBidBy: Option.none() },
      ]);
      // Pick 3 is worth 2,234 points, so A owes 1,787. Its first-round pick
      // (now 11, 1,329 points) goes; its second-round pick (21, 878 points)
      // finishes the payment and slides to 41, the first place worth no more
      // than its remaining 420 points.
      expect(result.payments).toEqual([
        {
          club: A,
          player: player(3),
          cost: 1787,
          surrendered: [11],
          slid: Option.some({ from: 21, to: 41 }),
          deficit: 0,
        },
      ]);
      expect(
        Arr.map(
          Arr.filter(result.selections, (s) => s.club === A),
          (s) => s.number,
        ),
      ).toEqual([3, 29, 39, 41]);
      expect(result.deficits).toEqual({});
    }),
  );

  it.effect("gives the player to the bidder when the bid is declined", () =>
    Effect.gen(function* () {
      const result = yield* AflDraft.run(
        draft,
        AflDraft.byRanking(
          () => players,
          () => false,
        ),
      );
      expect(result.selections[2]).toEqual({
        number: 3,
        round: 1,
        club: I,
        player: player(3),
        matchedBidBy: Option.none(),
      });
      expect(result.payments).toEqual([]);
    }),
  );

  it.effect("carries what a club cannot pay as a deficit", () =>
    Effect.gen(function* () {
      const result = yield* AflDraft.run(
        {
          ...draft,
          rounds: 1,
          trades: [{ round: 1, originalClub: A, club: B }],
        },
        AflDraft.byRanking(
          () => players,
          () => true,
        ),
      );
      expect(result.payments[0]?.deficit).toBe(1787);
      expect(result.deficits).toEqual({ A: 1787 });
    }),
  );

  it.effect("lets the nominating club take its own nominee without a bid", () =>
    Effect.gen(function* () {
      const result = yield* AflDraft.run(
        { ...draft, rounds: 1 },
        AflDraft.byRanking((club) => (club === A ? [player(3)] : Arr.drop(players, 3))),
      );
      expect(Arr.findFirst(result.selections, (s) => s.player === player(3))).toEqual(
        Option.some({
          number: 10,
          round: 1,
          club: A,
          player: player(3),
          matchedBidBy: Option.none(),
        }),
      );
    }),
  );

  it.effect("forfeits a passing club's remaining picks", () =>
    Effect.gen(function* () {
      const result = yield* AflDraft.run(
        { ...draft, nominations: [] },
        AflDraft.byRanking((club) => (club === J ? [] : players)),
      );
      expect(Arr.filter(result.selections, (s) => s.club === J)).toEqual([]);
      expect(result.selections).toHaveLength(37);
    }),
  );

  it.effect("rejects answers the rules do not allow", () =>
    Effect.gen(function* () {
      const unavailable = yield* Effect.flip(
        AflDraft.run(draft, () =>
          Effect.succeed({ _tag: "Select", player: Choice.AlternativeId("nobody") }),
        ),
      );
      expect(unavailable).toMatchObject({ _tag: "InvalidResponse", club: I });
      const noBid = yield* Effect.flip(
        AflDraft.run(draft, () => Effect.succeed(AflDraft.Response.Match())),
      );
      expect(noBid._tag).toBe("InvalidResponse");
    }),
  );

  it.effect("rejects a draft that cannot be run", () =>
    Effect.gen(function* () {
      const errors = yield* Effect.forEach(
        [
          { ...draft, rounds: 0 },
          { ...draft, trades: [{ round: 5, originalClub: A, club: B }] },
          {
            ...draft,
            nominations: [
              { player: Choice.AlternativeId("nobody"), club: A, kind: "FatherSon" as const },
            ],
          },
          { ...draft, discount: 2 },
        ],
        (invalid) => Effect.flip(AflDraft.run(invalid, bigBoard)),
        { concurrency: 1 },
      );
      expect(Arr.map(errors, (error) => error._tag)).toEqual([
        "InvalidDraft",
        "InvalidDraft",
        "InvalidDraft",
        "InvalidDraft",
      ]);
    }),
  );
});
