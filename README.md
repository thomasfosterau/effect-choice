# @thomasfosterau/effect-choice

Social choice mechanisms for [Effect](https://effect.website): elections, auctions and drafts as ways for actors to choose outcomes. Includes Hare-Clark STV, Treasury bond tenders and the AFL national draft.

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
- A sequential `Choice.Protocol` asks one actor at a time, and each answer changes what the next actor is asked: a draft.
- On the actors' side, a `Choice.Agent` answers a question. It can be a strategy, a script, a UI or a remote service.
- If a mechanism's own rules can't settle a tie, it asks the `TieBreak` rule in context. That rule draws lots by default and can be seeded, set to take the first, or set to refuse.

## Example

```ts
import * as Effect from "effect/Effect";
import { Choice, HareClark, TieBreak } from "@thomasfosterau/effect-choice";

const [ada, bea, cal] = ["ada", "bea", "cal"].map(Choice.AlternativeId);
const election = {
  seats: 2,
  candidates: [
    { id: ada, name: "Ada" },
    { id: bea, name: "Bea" },
    { id: cal, name: "Cal" },
  ],
};

const result = HareClark.count(election, [
  [ada, bea],
  [ada, bea],
  [ada, cal],
  [bea],
  [cal, bea],
]).pipe(Effect.provideService(TieBreak.TieBreak, TieBreak.refuse));
// result.elected, result.quota, and every count's transfers and totals
```

## Entry points

Every namespace is exported from the package root and from its own subpath (`@thomasfosterau/effect-choice/HareClark`), and each tree-shakes independently.

| Namespace     | For                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Choice`      | Actors, alternatives, sealed mechanisms, sequential protocols and the agents that answer them.                             |
| `TieBreak`    | The tie rule a mechanism falls back on: lot (the default), first or refuse.                                                |
| `HareClark`   | Tasmanian and ACT Hare-Clark STV: Droop quota, last-bundle Gregory surplus transfers, exact transfer values, a full count. |
| `BondAuction` | Sealed-bid yield tenders with discriminatory (AOFM) or uniform pricing, pro rata at the cut-off and RBA bond pricing.      |
| `AflDraft`    | The AFL national draft: draft order, priority and traded picks, father-son and academy bids matched with draft points.     |

## More

- [The mechanisms: rules implemented and simplifications](https://github.com/thomasfosterau/effect-choice/blob/trunk/docs/mechanisms.md)
- [Contributing](https://github.com/thomasfosterau/effect-choice/blob/trunk/docs/CONTRIBUTING.md), [security](https://github.com/thomasfosterau/effect-choice/blob/trunk/docs/SECURITY.md)
- The API reference is in each export's doc comments, which show in your editor and in the shipped `.d.ts` files.

## License

[MIT](https://github.com/thomasfosterau/effect-choice/blob/trunk/LICENSE.md)
