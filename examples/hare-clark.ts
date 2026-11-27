/**
 * Hare-Clark, the proportional single transferable vote of the Tasmanian
 * House of Assembly and the ACT Legislative Assembly, as a choice of
 * `Vote.stv` rules:
 *
 * - **Quota**: Droop, `floor(formal / (seats + 1)) + 1`.
 * - **Surpluses**: the last bundle (Gregory) method, largest surplus first.
 *   Each recipient gains its papers times the transfer value, rounded down.
 * - **Exclusions**: the lowest candidate's papers move one count per transfer
 *   value, highest value first.
 * - **Formality**: preferences count up to the first unknown or repeated
 *   candidate. The ACT needs one; Tasmania as many as there are vacancies.
 *
 * Robson rotation changes the order on the ballot paper but not the count, so
 * it is not modelled. Nor are casual-vacancy countbacks.
 */
import * as Effect from "effect/Effect";
import { type TieBreak, Vote } from "@thomasfosterau/effect-choice";

/** Where the election is held, which sets how many preferences a formal ballot needs. */
export type Jurisdiction = "ACT" | "Tasmania";

/** The Hare-Clark rules for `jurisdiction` in an election for `seats` vacancies. */
export const rules = (jurisdiction: Jurisdiction, seats: number): Vote.Rules => ({
  quota: Vote.droopQuota,
  surplus: "LastBundle",
  exclusion: "ByTransferValue",
  surplusOrder: "Largest",
  minimumPreferences: jurisdiction === "Tasmania" ? seats : 1,
});

/** Counts a Hare-Clark election. */
export const count = (
  election: Vote.Election,
  ballots: ReadonlyArray<Vote.Ballot>,
  jurisdiction: Jurisdiction = "ACT",
): Effect.Effect<Vote.Result, Vote.InvalidElection | TieBreak.TieUnresolved> =>
  Vote.stv(election, ballots, rules(jurisdiction, election.seats)).pipe(
    Effect.withSpan("HareClark.count"),
  );
