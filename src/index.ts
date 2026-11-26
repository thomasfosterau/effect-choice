/**
 * `@thomasfosterau/effect-choice`: social choice mechanisms for Effect.
 * Elections, auctions and drafts are all ways for actors to choose outcomes;
 * {@link Choice} is the model they share, and each mechanism is its own
 * tree-shakeable namespace.
 *
 * - **`Choice`**: actors, alternatives, sealed {@link Choice.Mechanism}s and
 *   sequential {@link Choice.Protocol}s, and the agents that answer them.
 * - **`TieBreak`**: the tie rule a mechanism falls back on.
 * - **`HareClark`**: the Hare-Clark single transferable vote used in
 *   Tasmania and the ACT.
 * - **`BondAuction`**: sealed-bid yield tenders for Treasury bonds, with
 *   discriminatory or uniform pricing.
 * - **`AflDraft`**: the AFL national draft, with priority picks, traded picks
 *   and father-son and academy bid matching.
 *
 * @since 0.1.0
 */

/**
 * Actors, alternatives, mechanisms, protocols and agents.
 *
 * @since 0.1.0
 */
export * as Choice from "./Choice.ts";

/**
 * Tie rules.
 *
 * @since 0.1.0
 */
export * as TieBreak from "./TieBreak.ts";

/**
 * Hare-Clark elections.
 *
 * @since 0.1.0
 */
export * as HareClark from "./HareClark.ts";

/**
 * Treasury bond tenders.
 *
 * @since 0.1.0
 */
export * as BondAuction from "./BondAuction.ts";

/**
 * The AFL national draft.
 *
 * @since 0.1.0
 */
export * as AflDraft from "./AflDraft.ts";
