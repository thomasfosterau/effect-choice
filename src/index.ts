/**
 * `@thomasfosterau/effect-choice`: social choice mechanisms for Effect.
 * Elections, auctions and drafts are all ways for actors to choose outcomes;
 * {@link Choice} is the model they share, and each mechanism is its own
 * tree-shakeable namespace.
 *
 * - **`Choice`**: actors, alternatives, sealed {@link Choice.Mechanism}s and
 *   sequential {@link Choice.Protocol}s, and the agents that answer them.
 * - **`TieBreak`**: the tie rule a mechanism falls back on.
 * - **`Vote`**: elections: first past the post, the single non-transferable
 *   vote, approval and Borda counts, instant runoff and the single
 *   transferable vote under configurable rules.
 * - **`Auction`**: sealed-bid auctions (first-price, second-price,
 *   discriminatory, uniform) and clock auctions (Dutch and English).
 * - **`Draft`**: linear and snake drafts with inserted and traded picks, and
 *   claims on players matched under pluggable rules.
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
 * Elections.
 *
 * @since 0.1.0
 */
export * as Vote from "./Vote.ts";

/**
 * Auctions.
 *
 * @since 0.1.0
 */
export * as Auction from "./Auction.ts";

/**
 * Drafts.
 *
 * @since 0.1.0
 */
export * as Draft from "./Draft.ts";
