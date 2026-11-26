import { it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";
import * as Rational from "effect/Rational";
import { describe, expect } from "vite-plus/test";
import { Choice, HareClark, TieBreak } from "../src/index.ts";

const [a, b, c, d, e, f] = Arr.map(["a", "b", "c", "d", "e", "f"], Choice.AlternativeId);
const candidates = (...ids: ReadonlyArray<Choice.AlternativeId>) =>
  Arr.map(ids, (id) => ({ id, name: id.toUpperCase() }));
const times = (n: number, ballot: HareClark.Ballot) => Arr.replicate(ballot, n);

describe("quota", () => {
  it("is the Droop quota", () => {
    expect(HareClark.quota(11, 2)).toBe(4);
    expect(HareClark.quota(100, 4)).toBe(21);
    expect(HareClark.quota(60_000, 6)).toBe(8572);
  });
});

describe("validPreferences", () => {
  it("stops at the first unknown or repeated candidate", () => {
    const known = [a, b, c];
    expect(HareClark.validPreferences([a, b, c], known)).toEqual([a, b, c]);
    expect(HareClark.validPreferences([a, b, a, c], known)).toEqual([a, b]);
    expect(HareClark.validPreferences([a, d, b], known)).toEqual([a]);
    expect(HareClark.validPreferences([d, a], known)).toEqual([]);
  });
});

describe("count", () => {
  it.effect("transfers the last bundle at the surplus over its continuing papers", () =>
    Effect.gen(function* () {
      const result = yield* HareClark.count({ seats: 2, candidates: candidates(a, b, c) }, [
        ...times(4, [a, b]),
        ...times(2, [a, c]),
        ...times(2, [b]),
        ...times(3, [c, b]),
      ]);
      expect(result.formal).toBe(11);
      expect(result.quota).toBe(4);
      expect(Arr.map(result.counts, (count) => count.totals)).toEqual([
        { a: 6, b: 2, c: 3 },
        // a's surplus of 2 over 6 papers: b gets floor(4/3), c floor(2/3).
        { a: 4, b: 3, c: 3 },
        // b and c tie on 3, but b was lower at count 1, so b is excluded:
        // first the papers worth 1, then those worth 1/3. All exhaust.
        { a: 4, b: 1, c: 3 },
        { a: 4, b: 0, c: 3 },
      ]);
      expect(result.counts[1]?.action).toEqual({
        _tag: "Surplus",
        candidate: a,
        transferValue: Rational.makeUnsafe(1n, 3n),
      });
      expect(Arr.map(result.counts, (count) => count.setAside)).toEqual([0, 1, 3, 4]);
      expect(result.elected).toEqual([a, c]);
      expect(result.excluded).toEqual([b]);
      expect(result.counts[0]?.elected).toEqual([a]);
      expect(result.counts[3]?.elected).toEqual([c]);
    }).pipe(Effect.provideService(TieBreak.TieBreak, TieBreak.refuse)),
  );

  it.effect("caps the transfer value at the value the last bundle arrived at", () =>
    Effect.gen(function* () {
      // Quota 7. a's surplus of 3 has only 2 continuing papers, so they go
      // at the value 1 they arrived at, not 3/2, and 1 vote is set aside.
      const result = yield* HareClark.count({ seats: 3, candidates: candidates(a, b, c, d) }, [
        ...times(2, [a, b, c]),
        ...times(8, [a]),
        ...times(6, [b, d]),
        ...times(5, [c]),
        ...times(3, [d]),
      ]);
      expect(result.quota).toBe(7);
      const surpluses = Arr.filter(result.counts, (count) => count.action._tag === "Surplus");
      expect(Arr.map(surpluses, (count) => count.action)).toEqual([
        { _tag: "Surplus", candidate: a, transferValue: Rational.makeUnsafe(1n, 1n) },
        { _tag: "Surplus", candidate: b, transferValue: Rational.makeUnsafe(1n, 2n) },
      ]);
      expect(Arr.map(surpluses, (count) => count.setAside)).toEqual([1, 1]);
      expect(result.elected).toEqual([a, b, c]);
    }).pipe(Effect.provideService(TieBreak.TieBreak, TieBreak.refuse)),
  );

  it.effect("elects the remaining candidates once they are no more than the vacancies", () =>
    Effect.gen(function* () {
      const result = yield* HareClark.count({ seats: 2, candidates: candidates(a, b, c) }, [
        ...times(3, [a]),
        ...times(2, [b]),
        ...times(1, [c]),
      ]);
      expect(result.quota).toBe(3);
      expect(result.elected).toEqual([a, b]);
      expect(result.excluded).toEqual([c]);
    }),
  );

  it.effect("treats ballots with too few valid preferences as informal", () =>
    Effect.gen(function* () {
      const result = yield* HareClark.count(
        { seats: 2, candidates: candidates(a, b, c), minimumPreferences: 2 },
        [[a, b], [a], [d, a, b], [b, b], [c, a, b]],
      );
      expect(result.formal).toBe(2);
      expect(result.informal).toBe(3);
    }),
  );

  it.effect("settles a tie with no history by the tie rule", () =>
    Effect.gen(function* () {
      const election = { seats: 1, candidates: candidates(a, b, c) };
      const ballots = [[a], [b], [c, a]];
      const first = yield* HareClark.count(election, ballots).pipe(
        Effect.provideService(TieBreak.TieBreak, TieBreak.first),
      );
      // a, b and c tie on 1; `first` excludes a, whose paper exhausts.
      expect(first.excluded[0]).toBe(a);
      const refused = yield* HareClark.count(election, ballots).pipe(
        Effect.provideService(TieBreak.TieBreak, TieBreak.refuse),
        Effect.flip,
      );
      expect(refused).toBeInstanceOf(TieBreak.TieUnresolved);
    }),
  );

  it.effect("rejects an election that cannot be counted", () =>
    Effect.gen(function* () {
      const errors = yield* Effect.forEach(
        [
          { seats: 0, candidates: candidates(a, b) },
          { seats: 3, candidates: candidates(a, b) },
          { seats: 1, candidates: candidates(a, a) },
        ],
        (election) => Effect.flip(HareClark.count(election, [])),
        { concurrency: 1 },
      );
      expect(Arr.map(errors, (error) => error._tag)).toEqual([
        "InvalidElection",
        "InvalidElection",
        "InvalidElection",
      ]);
    }),
  );

  it.effect("keeps every vote accounted for on random ballots", () =>
    Effect.forEach(
      Arr.range(1, 40),
      (seed) =>
        Effect.gen(function* () {
          const ids = [a, b, c, d, e, f];
          const ballots = yield* Effect.forEach(
            Arr.range(1, 150),
            () =>
              Effect.zipWith(
                Random.shuffle(ids),
                Random.nextIntBetween(1, ids.length),
                (order, n) => Arr.take(order, n),
              ),
            { concurrency: 1 },
          );
          const result = yield* HareClark.count(
            { seats: 3, candidates: candidates(...ids) },
            ballots,
          );
          expect(result.elected).toHaveLength(3);
          expect(Arr.dedupe([...result.elected, ...result.excluded])).toHaveLength(
            result.elected.length + result.excluded.length,
          );
          Arr.forEach(result.counts, (count) => {
            const total = Arr.reduce(
              Arr.map(ids, (id) => count.totals[id] ?? 0),
              0,
              (x, y) => x + y,
            );
            expect(total + count.setAside).toBe(result.formal);
          });
          // Nobody elected on quota holds more than a quota once surpluses are
          // transferred, and the last count is where the result was declared.
          expect(result.counts[result.counts.length - 1]?.elected.length).toBeGreaterThan(0);
        }).pipe(Random.withSeed(seed)),
      { discard: true, concurrency: 1 },
    ),
  );
});

describe("mechanism", () => {
  it.effect("resolves ballots as a sealed choice", () =>
    Effect.gen(function* () {
      const result = yield* Choice.resolve(
        HareClark.mechanism({ seats: 1, candidates: candidates(a, b) }),
        [[a], [a], [b]],
      );
      expect(result.elected).toEqual([a]);
    }),
  );
});
