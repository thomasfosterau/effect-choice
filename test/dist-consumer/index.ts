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
import { Auction, Choice, Draft, TieBreak, Vote } from "@thomasfosterau/effect-choice";
import * as VoteSubpath from "@thomasfosterau/effect-choice/Vote";

/** `true` only when `A` and `B` are mutually assignable, invariantly. */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails to type-check unless its type argument is `true`. */
const assert = <_ extends true>(): void => undefined;

// --- Subpaths --------------------------------------------------------------

assert<Equals<typeof VoteSubpath.stv, typeof Vote.stv>>();

// --- Choice -----------------------------------------------------------------

const actor: Choice.ActorId = Choice.ActorId("voter");
// @ts-expect-error -- `ActorId` is branded: a bare string is not one.
const unbranded: Choice.ActorId = "voter";

// --- Mechanisms -------------------------------------------------------------

assert<
  Equals<
    ReturnType<typeof Vote.stv>,
    Effect.Effect<Vote.Result, Vote.InvalidElection | TieBreak.TieUnresolved>
  >
>();
const fptp: Vote.Method = Vote.firstPastThePost;
assert<
  Equals<
    ReturnType<typeof Auction.run>,
    Effect.Effect<
      Auction.Result,
      Auction.InvalidAuction | Auction.InvalidBid | TieBreak.TieUnresolved
    >
  >
>();
assert<Equals<Auction.Result["marginalPrice"], Option.Option<number>>>();
assert<Equals<Draft.Response["_tag"], "Select" | "Pass" | "Match" | "Decline">>();
const pass: Draft.Response = Draft.Response.Pass();

export { actor, fptp, pass, unbranded };
