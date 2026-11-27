import { it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { describe, expect } from "vite-plus/test";
import { Choice, Draft } from "../src/index.ts";

const [X, Y, Z] = Arr.map(["X", "Y", "Z"], Choice.ActorId);
const players = Arr.map(Arr.range(1, 6), (n) => Choice.AlternativeId(`p${n}`));
const player = (n: number) => Choice.AlternativeId(`p${n}`);
const teams = (picks: ReadonlyArray<Draft.Pick>) => Arr.map(picks, (pick) => pick.team);
const bestAvailable = Draft.byRanking(() => players);
const drafted = (result: Draft.Result) =>
  Arr.map(result.selections, (s) => [s.number, s.team, s.player] as const);

describe("orders", () => {
  it("repeats the order every round in a linear draft", () => {
    expect(teams(Draft.linear([X, Y, Z], 2))).toEqual([X, Y, Z, X, Y, Z]);
  });

  it("reverses the order every other round in a snake draft", () => {
    const picks = Draft.snake([X, Y, Z], 3);
    expect(teams(picks)).toEqual([X, Y, Z, Z, Y, X, X, Y, Z]);
    expect(Arr.map(picks, (pick) => pick.round)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
  });

  it("inserts picks before an index, or at the end past it", () => {
    const extra: Draft.Pick = { round: 1, originalTeam: Z, team: Z, kind: "Priority" };
    expect(teams(Draft.insert(Draft.linear([X, Y], 1), 1, [extra]))).toEqual([X, Z, Y]);
    expect(teams(Draft.insert(Draft.linear([X, Y], 1), 9, [extra]))).toEqual([X, Y, Z]);
  });

  it.effect("trades a pick, which keeps its place and its original team", () =>
    Effect.gen(function* () {
      const picks = yield* Draft.trade(
        Draft.snake([X, Y, Z], 2),
        (pick) => pick.round === 2 && pick.originalTeam === X,
        Z,
      );
      expect(teams(picks)).toEqual([X, Y, Z, Z, Y, Z]);
      expect(picks[5]?.originalTeam).toBe(X);
      const missing = yield* Effect.flip(Draft.trade(picks, (pick) => pick.round === 3, Z));
      expect(missing._tag).toBe("InvalidDraft");
    }),
  );
});

describe("run", () => {
  const draft: Draft.Draft = { picks: Draft.snake([X, Y, Z], 2), players };

  it.effect("asks each pick's team in turn", () =>
    Effect.gen(function* () {
      const result = yield* Draft.run(draft, bestAvailable);
      expect(drafted(result)).toEqual([
        [1, X, player(1)],
        [2, Y, player(2)],
        [3, Z, player(3)],
        [4, Z, player(4)],
        [5, Y, player(5)],
        [6, X, player(6)],
      ]);
      expect(result.undrafted).toEqual([]);
    }),
  );

  it.effect("stops when the players run out, and forfeits a passing team's picks", () =>
    Effect.gen(function* () {
      const short = yield* Draft.run({ ...draft, players: Arr.take(players, 4) }, bestAvailable);
      expect(short.selections).toHaveLength(4);
      const passing = yield* Draft.run(
        draft,
        Draft.byRanking((team) => (team === Y ? [] : players)),
      );
      expect(Arr.map(passing.selections, (s) => s.team)).toEqual([X, Z, Z, X]);
      expect(passing.undrafted).toEqual([player(5), player(6)]);
    }),
  );

  const claimed: Draft.Draft = {
    ...draft,
    claims: [{ player: player(1), team: Z, kind: "Academy" }],
  };

  it.effect("lets a claiming team match a bid for free", () =>
    Effect.gen(function* () {
      const result = yield* Draft.run(claimed, bestAvailable);
      // X bids on p1 at pick 1; Z matches, and X picks again.
      expect(result.selections[0]).toEqual({
        number: 1,
        round: 1,
        team: Z,
        player: player(1),
        matchedBidBy: Option.some(X),
      });
      expect(Arr.map(result.selections, (s) => s.team)).toEqual([Z, X, Y, Z, Z, Y]);
      expect(result.payments[0]?.cost).toBe(0);
    }),
  );

  it.effect("makes a matching team forfeit its next pick", () =>
    Effect.gen(function* () {
      const result = yield* Draft.run(
        { ...claimed, matching: Draft.matchByForfeit },
        bestAvailable,
      );
      // Z's first own pick, then numbered 4, goes.
      expect(Arr.map(result.selections, (s) => s.team)).toEqual([Z, X, Y, Z, Y, X]);
      expect(result.payments[0]).toMatchObject({ surrendered: [4], deficit: 0 });
    }),
  );

  it.effect("gives the player to the bidder when the claim is declined", () =>
    Effect.gen(function* () {
      const result = yield* Draft.run(
        claimed,
        Draft.byRanking(
          () => players,
          () => false,
        ),
      );
      expect(drafted(result)[0]).toEqual([1, X, player(1)]);
      expect(result.payments).toEqual([]);
    }),
  );

  it.effect("pays a points bill with later picks, sliding the last one back", () =>
    Effect.gen(function* () {
      // Picks are worth 60, 50, ..., 10 points; matching pick 1 costs 60.
      const matching = Draft.matchWithPoints({ points: (n) => Math.max(0, 70 - 10 * n) });
      const result = yield* Draft.run({ ...claimed, matching }, bestAvailable);
      // Z's picks after the match are 4 (30 points) and 5 (20): both go, and
      // 10 points are still owed once they run out.
      expect(result.payments[0]).toMatchObject({ cost: 60, surrendered: [4, 5], deficit: 10 });
      expect(result.deficits).toEqual({ Z: 10 });
      const discounted = yield* Draft.run(
        {
          ...claimed,
          matching: Draft.matchWithPoints({
            points: (n) => Math.max(0, 70 - 10 * n),
            discount: 0.5,
          }),
        },
        bestAvailable,
      );
      // 30 owed: pick 4 (30 points) pays it exactly.
      expect(discounted.payments[0]).toMatchObject({ cost: 30, surrendered: [4], deficit: 0 });
    }),
  );

  it.effect("rejects answers and drafts the rules do not allow", () =>
    Effect.gen(function* () {
      const unavailable = yield* Effect.flip(
        Draft.run(draft, () =>
          Effect.succeed(Draft.Response.Select({ player: Choice.AlternativeId("nobody") })),
        ),
      );
      expect(unavailable).toMatchObject({ _tag: "InvalidResponse", team: X });
      const noBid = yield* Effect.flip(
        Draft.run(draft, () => Effect.succeed(Draft.Response.Match())),
      );
      expect(noBid._tag).toBe("InvalidResponse");
      const notInPool = yield* Effect.flip(
        Draft.run(
          {
            ...draft,
            claims: [{ player: Choice.AlternativeId("nobody"), team: Z, kind: "Academy" }],
          },
          bestAvailable,
        ),
      );
      expect(notInPool._tag).toBe("InvalidDraft");
      const twice = yield* Effect.flip(
        Draft.run(
          {
            ...draft,
            claims: [
              { player: player(1), team: Z, kind: "Academy" },
              { player: player(1), team: Y, kind: "Academy" },
            ],
          },
          bestAvailable,
        ),
      );
      expect(twice._tag).toBe("InvalidDraft");
    }),
  );
});
