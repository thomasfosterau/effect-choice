/**
 * A consumer of the published package, type-checked against the emitted
 * `dist/*.d.ts` by `vp run check:dist` (see `./tsconfig.json`). It is never run
 * or bundled: every line exists to make the compiler resolve and check one
 * piece of the public surface. Keep it to a few representative uses per
 * namespace; an assertion here pins a type a consumer relies on, so update it
 * only alongside a changeset that changes that type.
 *
 * @module dist-consumer
 */

import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

// The public name, resolved through package.json `exports` (a self-reference:
// the nearest package.json is the package's own), so this reaches
// `dist/index.d.ts` exactly as an installed copy would.
import { AflDraft, BondAuction, Choice, HareClark, TieBreak } from "@thomasfosterau/effect-choice";
import * as HareClarkSubpath from "@thomasfosterau/effect-choice/HareClark";

/** `true` only when `A` and `B` are mutually assignable, invariantly. */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails to type-check unless its type argument is `true`. */
const assert = <_ extends true>(): void => undefined;

// --- Subpaths --------------------------------------------------------------

assert<Equals<typeof HareClarkSubpath.count, typeof HareClark.count>>();

// --- Choice -----------------------------------------------------------------

const actor: Choice.ActorId = Choice.ActorId("voter");
// @ts-expect-error -- `ActorId` is branded: a bare string is not one.
const unbranded: Choice.ActorId = "voter";

// --- Mechanisms -------------------------------------------------------------

assert<
  Equals<
    ReturnType<typeof HareClark.count>,
    Effect.Effect<HareClark.Result, HareClark.InvalidElection | TieBreak.TieUnresolved>
  >
>();
assert<
  Equals<
    ReturnType<typeof BondAuction.allocate>,
    Effect.Effect<
      BondAuction.Result,
      BondAuction.InvalidTender | BondAuction.InvalidBid | TieBreak.TieUnresolved
    >
  >
>();
assert<Equals<BondAuction.Result["cutoffYield"], Option.Option<number>>>();
assert<Equals<AflDraft.Response["_tag"], "Select" | "Pass" | "Match" | "Decline">>();
const pass: AflDraft.Response = AflDraft.Response.Pass();

export { actor, pass, unbranded };
