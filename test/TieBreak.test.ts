import { it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Random from "effect/Random";
import { describe, expect } from "vite-plus/test";
import { TieBreak } from "../src/index.ts";

describe("choose", () => {
  it.effect("needs no rule for a single value", () =>
    Effect.gen(function* () {
      const only = yield* TieBreak.choose(["a"], "test").pipe(
        Effect.provideService(TieBreak.TieBreak, TieBreak.refuse),
      );
      expect(only).toBe("a");
    }),
  );

  it.effect("draws lots by default, reproducibly under a seed", () =>
    Effect.gen(function* () {
      const draw = TieBreak.choose(["a", "b", "c", "d"], "test");
      const once = yield* Effect.forEach(
        [1, 2, 3, 4, 5, 6],
        (seed) => draw.pipe(Random.withSeed(seed)),
        { concurrency: 1 },
      );
      const again = yield* Effect.forEach(
        [1, 2, 3, 4, 5, 6],
        (seed) => draw.pipe(Random.withSeed(seed)),
        { concurrency: 1 },
      );
      expect(once).toEqual(again);
      expect(Arr.dedupe(once).length).toBeGreaterThan(1);
    }),
  );

  it.effect("takes the first value, or refuses, when told to", () =>
    Effect.gen(function* () {
      const first = yield* TieBreak.choose(["a", "b"], "test").pipe(
        Effect.provideService(TieBreak.TieBreak, TieBreak.first),
      );
      expect(first).toBe("a");
      const refused = yield* TieBreak.choose(["a", "b"], "a test tie").pipe(
        Effect.provideService(TieBreak.TieBreak, TieBreak.refuse),
        Effect.flip,
      );
      expect(refused).toMatchObject({ _tag: "TieUnresolved", reason: "a test tie", tied: 2 });
    }),
  );
});
