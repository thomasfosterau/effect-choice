# The mechanisms

Each mechanism is a way for actors to choose outcomes, with rules you configure. This page lists the rules each module offers and where it simplifies them. The module doc comments go into more detail, and [`examples/`](https://github.com/thomasfosterau/effect-choice/tree/trunk/examples) shows real-world systems assembled from them.

## Elections (`Vote`)

Voters' ballots list candidates in order of preference (or, for approval voting, the candidates they approve of). Preferences count up to the first unknown or repeated candidate, and a ballot needs at least `minimumPreferences` of them to be formal (default 1).

| Method                          | Rule                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `firstPastThePost`              | One seat: the most first preferences wins.                                                                         |
| `plurality`                     | The `seats` candidates with the most first preferences. With more than one seat, the single non-transferable vote. |
| `approval`                      | One point for each candidate a ballot lists. The `seats` most approved are elected.                                |
| `borda`                         | With `n` candidates, `n - 1` points for a first preference, `n - 2` for a second, and so on.                       |
| `instantRunoff(rules)`          | One seat, by the single transferable vote.                                                                         |
| `stv(election, ballots, rules)` | The single transferable vote, with the rules below.                                                                |

| STV rule       | Options                                                                                                                                                                                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quota`        | `droopQuota` (the default), `floor(formal / (seats + 1)) + 1`; `hareQuota`, `ceil(formal / seats)`; or your own function.                                                                                                                                                                 |
| `surplus`      | `"WeightedInclusive"` (the default): every paper, each parcel at its own value times surplus over total. `"Inclusive"`: every paper at surplus over papers. `"LastBundle"`: only the parcel that reached quota, at surplus over its continuing papers, capped at the value it arrived at. |
| `exclusion`    | `"AllAtOnce"` (the default), or `"ByTransferValue"`: one count per value, highest first.                                                                                                                                                                                                  |
| `surplusOrder` | `"Largest"` (the default) or `"ElectionOrder"`.                                                                                                                                                                                                                                           |
| Every count    | Each recipient gets the floor of its papers times their value. Exhausted papers and fractions lost to rounding are set aside, so the totals plus the set-aside always equal the formal vote. Values are exact `Rational`s.                                                                |
| Election       | A candidate is elected at quota and gets no more papers. When the continuing candidates are no more than the vacancies left, they're all elected.                                                                                                                                         |
| Ties           | Decided by the most recent count at which the tied candidates' totals differed, then by the `TieBreak` rule.                                                                                                                                                                              |

Scoring methods send ties straight to the `TieBreak` rule.

## Auctions (`Auction`)

### Sealed bids (`run`, `mechanism`)

Each bid is a quantity at a price. The supply goes to the best bids first.

| Rule                 | Options                                                                                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `better`             | `"Highest"` (the default) or `"Lowest"`, for bids made in yields or rates.                                                                                                                                        |
| `reserve`            | Bids worse than it are rejected.                                                                                                                                                                                  |
| `rationing`          | At the marginal price, `"ProRata"` (the default) in whole units, with units left by rounding going to the largest remainders; or `"ByLot"`, whole bids in an order the `TieBreak` rule draws.                     |
| `pricing`            | `payAsBid` (the default; discriminatory), `uniform` (the marginal accepted price), `firstRejected` (the best price rejected for want of supply, else the reserve: with one unit, a Vickrey auction), or your own. |
| `unit`, `minimumBid` | Quantities are whole multiples of the unit, and at least the minimum.                                                                                                                                             |
| Reported             | Each bid's allocation and price, the marginal price, the share allocated at the margin, the weighted average price and the coverage ratio.                                                                        |

### Clock auctions (`dutch`, `english`)

The auctioneer calls a price and asks each bidder in turn, as a sequential `Choice.Protocol`.

| Auction   | Rule                                                                                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dutch`   | The price falls by `step` from `start` to `floor`. At each price every bidder is asked how many units it takes. Takes at one price that exceed what is left are filled whole, in an order the `TieBreak` rule draws. Each buyer pays the price it took at.                           |
| `english` | One item. The price rises by `step` from `start`, and every bidder still in is asked whether it stays. The last one in buys at that price. If everyone drops out at once, the `TieBreak` rule picks among those still in at the previous price. If nobody opens, the item is unsold. |

`truthful` is an agent that bids up to each bidder's private value.

## Drafts (`Draft`)

Teams take turns choosing players with the picks they hold, as a sequential `Choice.Protocol`.

| Rule       | Options                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order      | `linear` (the same order every round) or `snake` (reversed every other round), then reshaped with `insert` (priority or compensation picks) and `trade`. A traded pick keeps its place and remembers its original team.                                                                                                                                                                              |
| Claims     | A team may claim a player. When another team selects them, that is a bid; if the claiming team matches, it gets the player at that pick, the bidder's pick and every later one move back a place, and the bidder chooses again.                                                                                                                                                                      |
| `matching` | `matchFree` (the default), `matchByForfeit` (the matching team's next pick), or `matchWithPoints({ points, discount })`: the bid pick's points less the discount, paid with later picks. Picks worth no more than what's still owed are surrendered, the one that finishes the payment slides back to the first place worth no more than its remaining points, and anything still owed is a deficit. |
| Passing    | A team that passes gives up its remaining picks.                                                                                                                                                                                                                                                                                                                                                     |

`byRanking` is an agent that drafts from a ranking of players. To use real teams' decisions, provide any `Choice.Agent<Prompt, Response>` instead.
