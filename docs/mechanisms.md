# The mechanisms

Each mechanism is a way for actors to choose outcomes. This page explains which rules each one implements and where it simplifies them. The module doc comments go into more detail.

## Hare-Clark (`HareClark`)

This is the proportional single transferable vote used for the Tasmanian House of Assembly and the ACT Legislative Assembly.

| Rule               | Implemented as                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Formality          | Preferences count up to the first unknown or repeated candidate. A ballot needs at least `minimumPreferences` of them: the default is 1 (ACT), and for Tasmania pass the number of vacancies.                                                                                  |
| Quota              | Droop: `floor(formal / (seats + 1)) + 1`.                                                                                                                                                                                                                                      |
| Surplus transfers  | Last bundle (Gregory). Only the parcel that took the candidate to quota is re-examined. Its transfer value is the surplus divided by the papers with a next continuing preference, capped at the value those papers arrived with. Each recipient gets `floor(papers × value)`. |
| Order of surpluses | Largest first.                                                                                                                                                                                                                                                                 |
| Exclusions         | The lowest candidate is excluded. Their papers move one count per transfer value, highest value first.                                                                                                                                                                         |
| Election           | A candidate is elected at quota and gets no more papers. When the continuing candidates are no more than the vacancies left, they're all elected.                                                                                                                              |
| Ties               | Decided by the most recent count at which the tied candidates' totals differed, then by the `TieBreak` rule.                                                                                                                                                                   |
| Set aside          | Exhausted papers and fractions lost to rounding are added up, so the totals plus the set-aside always equal the formal vote.                                                                                                                                                   |
| Not modelled       | Robson rotation, which changes the order on the ballot paper but not the count. Casual-vacancy countbacks.                                                                                                                                                                     |

Transfer values are exact `Rational`s, so recounting the same ballots gives the same result to the vote.

## Bond tenders (`BondAuction`)

This is a sealed-bid yield tender, the way the Australian Office of Financial Management issues Treasury Bonds.

| Rule         | Implemented as                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acceptance   | Bids are accepted from the lowest yield up until the offer is filled.                                                                                                                                                                             |
| The cut-off  | Bids at the highest accepted yield share what remains pro rata, in whole allocation units. Units left over go one each to the largest remainders. If there are more equal remainders than units, the `TieBreak` rule decides.                     |
| Pricing      | Discriminatory (multiple-price, the AOFM's rule) prices each bid at its own yield. Uniform prices every bid at the cut-off.                                                                                                                       |
| Price        | Uses the Reserve Bank's Treasury Bond formula, per $100 face value, rounded to three decimal places. Coupons are half-yearly on the maturity date's day. A settlement within seven days of a coupon is ex-interest. Consideration is to the cent. |
| Reported     | Allocation per bid, cut-off yield, share allocated at the cut-off, weighted average yield and coverage ratio.                                                                                                                                     |
| Not modelled | Non-competitive bids, limits on bids per bidder, and the issuer's discretion to scale back an issue.                                                                                                                                              |

## The AFL draft (`AflDraft`)

This is the AFL national draft, run as a sequential protocol: the club on the clock picks a player, and the protocol asks the next club.

| Rule           | Implemented as                                                                                                                                                                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order          | Non-finalists in reverse ladder order, then finalists by the week they were eliminated (reverse ladder order within a week), then the runner-up and the premier. The same order repeats every round.                                                                                                                                                     |
| Priority picks | At the start of the first round, or at the end of the first or second round.                                                                                                                                                                                                                                                                             |
| Trades         | A traded pick keeps its place in the order and changes owner.                                                                                                                                                                                                                                                                                            |
| Bids           | When a club selects a player another club has nominated (father-son, academy or Next Generation Academy), that counts as a bid. If the nominating club matches, it gets the player at the bid's pick. The bidder's pick and every later pick move back one place, and the bidder picks again.                                                            |
| Payment        | The bid pick's points, less a discount (20 per cent by default), paid with the matching club's next picks in order. Picks are surrendered while they're worth no more than what's still owed. The pick that finishes the payment slides back to the first place worth no more than its remaining points. Whatever is still owed after that is a deficit. |
| Points         | The draft value index as introduced in 2015 (3,000 points for pick 1). Pass `points` and `discount` to use another year's values.                                                                                                                                                                                                                        |
| Passing        | A club that passes gives up its remaining picks.                                                                                                                                                                                                                                                                                                         |
| Not modelled   | Free-agency compensation picks (add them as priority picks), the rookie and mid-season drafts, live trading during the draft, and the limits on which picks may pay for a bid. These limits have changed from year to year.                                                                                                                              |

The `byRanking` agent drafts from a ranking of players, which makes a draft simple to simulate. To use real clubs' decisions, provide any `Choice.Agent<Prompt, Response>` instead.
