import { it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";
import { Choice } from "@thomasfosterau/effect-choice";
import * as HareClark from "../../examples/hare-clark.ts";

const [a, b, c] = Arr.map(["a", "b", "c"], Choice.AlternativeId);
const election = { seats: 2, candidates: Arr.map([a, b, c], (id) => ({ id, name: id })) };
const ballots = [
  ...Arr.replicate([a, b], 4),
  ...Arr.replicate([a, c], 2),
  ...Arr.replicate([b], 2),
  ...Arr.replicate([c, b], 3),
];

describe("count", () => {
  it.effect("counts with the last-bundle rules", () =>
    Effect.gen(function* () {
      const result = yield* HareClark.count(election, ballots);
      expect(result.quota).toBe(4);
      // b's exclusion runs one count per transfer value: 1, then 1/3.
      expect(Arr.map(result.counts, (count) => count.action._tag)).toEqual([
        "FirstPreferences",
        "Surplus",
        "Exclusion",
        "Exclusion",
      ]);
      expect(result.elected).toEqual([a, c]);
    }),
  );

  it.effect("needs as many preferences as vacancies in Tasmania", () =>
    Effect.gen(function* () {
      const act = yield* HareClark.count(election, ballots, "ACT");
      const tasmania = yield* HareClark.count(election, ballots, "Tasmania");
      expect(act.informal).toBe(0);
      expect(tasmania.informal).toBe(2);
    }),
  );
});
