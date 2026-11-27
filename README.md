# @thomasfosterau/effect-choice

Social choice mechanisms for [Effect](https://effect.website): elections, auctions and drafts as ways for actors to choose outcomes, each with configurable rules. First past the post, instant runoff and STV; sealed-bid, Vickrey, Dutch and English auctions; linear and snake drafts.

> [!CAUTION]
> Experimental and pre-1.0, largely written with Claude Code. The API may change between minor versions. Don't use it to declare a real election or allocate a real tender.

## Install

```sh
pnpm add @thomasfosterau/effect-choice effect
```

`effect` (`^4.0.0`) is a peer dependency. ESM only; Node 22+, browsers and Workers.

## The model

Every mechanism here has the same three parts. **Actors** (voters, bidders, clubs) express choices over **alternatives** (candidates, bonds, players), and a **mechanism** turns those choices into an **outcome**.

- A sealed `Choice.Mechanism` takes every actor's choice at once: a ballot box or a tender.
- A sequential `Choice.Protocol` asks one actor at a time, and each answer changes what the next actor is asked: a draft or a clock auction.
- On the actors' side, a `Choice.Agent` answers a question. It can be a strategy, a script, a UI or a remote service.
- If a mechanism's own rules can't settle a tie, it asks the `TieBreak` rule in context. That rule draws lots by default and can be seeded, set to take the first, or set to refuse.

## Example

```ts
import * as Effect from "effect/Effect";
import { Auction, Choice, Draft, TieBreak, Vote } from "@thomasfosterau/effect-choice";

const [ada, bea, cal] = ["ada", "bea", "cal"].map(Choice.AlternativeId);
const election = {
  seats: 2,
  candidates: [
    { id: ada, name: "Ada" },
    { id: bea, name: "Bea" },
    { id: cal, name: "Cal" },
  ],
};
const ballots = [[ada, bea], [ada, bea], [ada, cal], [bea], [cal, bea]];

// The single transferable vote under Hare-Clark's rules.
const stv = Vote.stv(election, ballots, { surplus: "LastBundle", exclusion: "ByTransferValue" });
// Instant runoff or first past the post for one seat.
const irv = Vote.instantRunoff()({ ...election, seats: 1 }, ballots);
const fptp = Vote.firstPastThePost({ ...election, seats: 1 }, ballots);

// A Dutch auction: the price falls from 100 until someone takes the item.
const [x, y] = ["x", "y"].map(Choice.ActorId);
const dutch = Auction.dutch(
  { bidders: [x, y], start: 100, step: 5 },
  Auction.truthful((bidder) => (bidder === x ? 70 : 85)),
);

// A two-round snake draft, each team taking the best player left.
const draft = Draft.run(
  { picks: Draft.snake([x, y], 2), players: [ada, bea, cal] },
  Draft.byRanking(() => [ada, bea, cal]),
);

const program = Effect.all([stv, irv, fptp, dutch, draft]).pipe(
  Effect.provideService(TieBreak.TieBreak, TieBreak.refuse),
);
```

## Entry points

Every namespace is exported from the package root and from its own subpath (`@thomasfosterau/effect-choice/Vote`), and each tree-shakes independently.

| Namespace  | For                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Choice`   | Actors, alternatives, sealed mechanisms, sequential protocols and the agents that answer them.                                                                                       |
| `TieBreak` | The tie rule a mechanism falls back on: lot (the default), first or refuse.                                                                                                          |
| `Vote`     | First past the post, plurality (SNTV), approval, Borda, instant runoff, and STV with a choice of quota, surplus transfer (last bundle, inclusive, weighted inclusive) and exclusion. |
| `Auction`  | Sealed-bid multi-unit auctions (pay-as-bid, uniform, first-rejected or Vickrey; reserves; pro rata or by lot at the margin) and Dutch and English clock auctions.                    |
| `Draft`    | Linear and snake drafts, inserted and traded picks, and claims on players matched for free, by forfeit or for draft points.                                                          |

## Examples

[`examples/`](https://github.com/thomasfosterau/effect-choice/tree/trunk/examples) shows how to build specific real-world systems on the library:

- [Hare-Clark](https://github.com/thomasfosterau/effect-choice/blob/trunk/examples/hare-clark.ts), the STV of Tasmania and the ACT, as a set of `Vote.stv` rules.
- [A Treasury Bond tender](https://github.com/thomasfosterau/effect-choice/blob/trunk/examples/bond-auction.ts) as the AOFM runs it: a sealed `Auction` on yields, priced by the Reserve Bank's bond formula.
- [The AFL national draft](https://github.com/thomasfosterau/effect-choice/blob/trunk/examples/afl-draft.ts): the order from the season's ladder and finals, priority picks, trades, and father-son and academy bids matched with draft value index points.

## More

- [The mechanisms: rules implemented and simplifications](https://github.com/thomasfosterau/effect-choice/blob/trunk/docs/mechanisms.md)
- [Contributing](https://github.com/thomasfosterau/effect-choice/blob/trunk/docs/CONTRIBUTING.md), [security](https://github.com/thomasfosterau/effect-choice/blob/trunk/docs/SECURITY.md)
- The API reference is in each export's doc comments, which show in your editor and in the shipped `.d.ts` files.

## License

[MIT](https://github.com/thomasfosterau/effect-choice/blob/trunk/LICENSE.md)
