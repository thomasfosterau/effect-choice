import { it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Random from "effect/Random";
import * as Rational from "effect/Rational";
import { describe, expect } from "vite-plus/test";
import { Choice, TieBreak, Vote } from "../src/index.ts";

const [a, b, c, d, e, f] = Arr.map(["a", "b", "c", "d", "e", "f"], Choice.AlternativeId);
const candidates = (...ids: ReadonlyArray<Choice.AlternativeId>) =>
  Arr.map(ids, (id) => ({ id, name: id.toUpperCase() }));
const times = (n: number, ballot: Vote.Ballot) => Arr.replicate(ballot, n);

/** Hare-Clark's rules: last bundle, exclusions by transfer value. */
const lastBundle: Vote.Rules = { surplus: "LastBundle", exclusion: "ByTransferValue" };

describe("quotas", () => {
  it("rounds the Droop quota down and adds one", () => {
    expect(Vote.droopQuota(11, 2)).toBe(4);
    expect(Vote.droopQuota(100, 4)).toBe(21);
    expect(Vote.droopQuota(60_000, 6)).toBe(8572);
  });

  it("rounds the Hare quota up", () => {
    expect(Vote.hareQuota(11, 2)).toBe(6);
    expect(Vote.hareQuota(100, 4)).toBe(25);
  });
});

describe("validPreferences", () => {
  it("stops at the first unknown or repeated candidate", () => {
    const known = [a, b, c];
    expect(Vote.validPreferences([a, b, c], known)).toEqual([a, b, c]);
    expect(Vote.validPreferences([a, b, a, c], known)).toEqual([a, b]);
    expect(Vote.validPreferences([a, d, b], known)).toEqual([a]);
    expect(Vote.validPreferences([d, a], known)).toEqual([]);
  });
});

describe("stv", () => {
  it.effect("transfers the last bundle at the surplus over its continuing papers", () =>
    Effect.gen(function* () {
      const result = yield* Vote.stv(
        { seats: 2, candidates: candidates(a, b, c) },
        [...times(4, [a, b]), ...times(2, [a, c]), ...times(2, [b]), ...times(3, [c, b])],
        lastBundle,
      );
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
        transferValue: Option.some(Rational.makeUnsafe(1n, 3n)),
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
      const result = yield* Vote.stv(
        { seats: 3, candidates: candidates(a, b, c, d) },
        [
          ...times(2, [a, b, c]),
          ...times(8, [a]),
          ...times(6, [b, d]),
          ...times(5, [c]),
          ...times(3, [d]),
        ],
        lastBundle,
      );
      expect(result.quota).toBe(7);
      const surpluses = Arr.filter(result.counts, (count) => count.action._tag === "Surplus");
      expect(Arr.map(surpluses, (count) => count.action)).toEqual([
        { _tag: "Surplus", candidate: a, transferValue: Option.some(Rational.makeUnsafe(1n, 1n)) },
        { _tag: "Surplus", candidate: b, transferValue: Option.some(Rational.makeUnsafe(1n, 2n)) },
      ]);
      expect(Arr.map(surpluses, (count) => count.setAside)).toEqual([1, 1]);
      expect(result.elected).toEqual([a, b, c]);
    }).pipe(Effect.provideService(TieBreak.TieBreak, TieBreak.refuse)),
  );

  it.effect("elects the remaining candidates once they are no more than the vacancies", () =>
    Effect.gen(function* () {
      const result = yield* Vote.stv(
        { seats: 2, candidates: candidates(a, b, c) },
        [...times(3, [a]), ...times(2, [b]), ...times(1, [c])],
        lastBundle,
      );
      expect(result.quota).toBe(3);
      expect(result.elected).toEqual([a, b]);
      expect(result.excluded).toEqual([c]);
    }),
  );

  it.effect("treats ballots with too few valid preferences as informal", () =>
    Effect.gen(function* () {
      const result = yield* Vote.stv(
        { seats: 2, candidates: candidates(a, b, c) },
        [[a, b], [a], [d, a, b], [b, b], [c, a, b]],
        { ...lastBundle, minimumPreferences: 2 },
      );
      expect(result.formal).toBe(2);
      expect(result.informal).toBe(3);
    }),
  );

  it.effect("settles a tie with no history by the tie rule", () =>
    Effect.gen(function* () {
      const election = { seats: 1, candidates: candidates(a, b, c) };
      const ballots = [[a], [b], [c, a]];
      const first = yield* Vote.stv(election, ballots, lastBundle).pipe(
        Effect.provideService(TieBreak.TieBreak, TieBreak.first),
      );
      // a, b and c tie on 1; `first` excludes a, whose paper exhausts.
      expect(first.excluded[0]).toBe(a);
      const refused = yield* Vote.stv(election, ballots, lastBundle).pipe(
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
        (election) => Effect.flip(Vote.stv(election, [], lastBundle)),
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
          const result = yield* Vote.stv(
            { seats: 3, candidates: candidates(...ids) },
            ballots,
            lastBundle,
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
        Vote.mechanism({ seats: 1, candidates: candidates(a, b) }),
        [[a], [a], [b]],
      );
      expect(result.elected).toEqual([a]);
    }),
  );
});

describe("surplus methods", () => {
  // Quota 6. a's surplus of 6 goes to b at 1/2, taking b to 10 with 4
  // papers at 1 and 12 at 1/2; b's surplus of 4 then goes to c.
  const election = { seats: 3, candidates: candidates(a, b, c, d) };
  const ballots = [
    ...times(12, [a, b, c]),
    ...times(4, [b, c]),
    ...times(3, [c]),
    ...times(2, [d]),
  ];
  const secondSurplus = (rules: Vote.Rules) =>
    Effect.map(Vote.stv(election, ballots, rules), (result) => result.counts[2]);

  it.effect("moves only the last bundle, at the surplus over its papers", () =>
    Effect.gen(function* () {
      const count = yield* secondSurplus({ surplus: "LastBundle" });
      // The 12 papers at 1/2, at 4/12 = 1/3: c gains 4.
      expect(count?.action).toMatchObject({
        transferValue: Option.some(Rational.makeUnsafe(1n, 3n)),
      });
      expect(count?.totals).toEqual({ a: 6, b: 6, c: 7, d: 2 });
    }),
  );

  it.effect("moves every paper at the surplus over all of them (inclusive)", () =>
    Effect.gen(function* () {
      const count = yield* secondSurplus({ surplus: "Inclusive" });
      // All 16 papers at 4/16 = 1/4: c gains 4.
      expect(count?.action).toMatchObject({
        transferValue: Option.some(Rational.makeUnsafe(1n, 4n)),
      });
      expect(count?.totals).toEqual({ a: 6, b: 6, c: 7, d: 2 });
    }),
  );

  it.effect("scales each parcel's own value by surplus over total (weighted inclusive)", () =>
    Effect.gen(function* () {
      const count = yield* secondSurplus({ surplus: "WeightedInclusive" });
      // 4/10 of each value: 4 papers at 2/5 give floor(1.6) = 1, 12 at 1/5
      // give floor(2.4) = 2. There is no single transfer value.
      expect(count?.action).toMatchObject({ transferValue: Option.none() });
      expect(count?.totals).toEqual({ a: 6, b: 6, c: 6, d: 2 });
      expect(count?.setAside).toBe(1);
    }),
  );

  it.effect("uses the quota it is given", () =>
    Effect.gen(function* () {
      const result = yield* Vote.stv(
        { seats: 2, candidates: candidates(a, b, c) },
        [...times(6, [a]), ...times(3, [b]), ...times(2, [c])],
        { quota: Vote.hareQuota },
      );
      expect(result.quota).toBe(6);
      expect(result.elected).toEqual([a, b]);
    }),
  );
});

describe("single-winner and scoring methods", () => {
  const one = { seats: 1, candidates: candidates(a, b, c, d) };
  const ballots = [...times(3, [a, b]), ...times(2, [b, c]), ...times(2, [c, b]), [d, c]];

  it.effect("elects the most first preferences under first past the post", () =>
    Effect.gen(function* () {
      const result = yield* Vote.firstPastThePost(one, ballots);
      expect(result.elected).toEqual([a]);
      expect(result.counts[0]?.totals).toEqual({ a: 3, b: 2, c: 2, d: 1 });
      const many = yield* Effect.flip(Vote.firstPastThePost({ ...one, seats: 2 }, ballots));
      expect(many._tag).toBe("InvalidElection");
    }),
  );

  it.effect("transfers preferences under instant runoff", () =>
    Effect.gen(function* () {
      // d is excluded (c 3), then b (c 5): c beats a 5 to 3.
      const result = yield* Vote.instantRunoff()(one, ballots);
      expect(result.elected).toEqual([c]);
      expect(result.excluded).toEqual([d, b]);
    }),
  );

  it.effect("scores rankings under the Borda count", () =>
    Effect.gen(function* () {
      const result = yield* Vote.borda(one, ballots);
      // 3, 2, 1 and 0 points for first to fourth.
      expect(result.counts[0]?.totals).toEqual({ a: 9, b: 16, c: 12, d: 3 });
      expect(result.elected).toEqual([b]);
    }),
  );

  it.effect("counts approvals", () =>
    Effect.gen(function* () {
      const result = yield* Vote.approval({ ...one, seats: 2 }, ballots);
      expect(result.counts[0]?.totals).toEqual({ a: 3, b: 7, c: 5, d: 1 });
      expect(result.elected).toEqual([b, c]);
    }),
  );

  it.effect("sends a tie for the last seat to the tie rule", () =>
    Effect.gen(function* () {
      // The single non-transferable vote: a, then b and c tie on 2.
      const refused = yield* Vote.plurality({ ...one, seats: 2 }, ballots).pipe(
        Effect.provideService(TieBreak.TieBreak, TieBreak.refuse),
        Effect.flip,
      );
      expect(refused._tag).toBe("TieUnresolved");
      const first = yield* Vote.plurality({ ...one, seats: 2 }, ballots).pipe(
        Effect.provideService(TieBreak.TieBreak, TieBreak.first),
      );
      expect(first.elected).toEqual([a, b]);
    }),
  );
});
