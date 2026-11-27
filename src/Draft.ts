/**
 * Drafts, as a sequential {@link Choice.Protocol}: teams (actors) take turns
 * choosing players (alternatives) with the picks they hold.
 *
 * A draft is a list of picks in order. Build it with {@link linear} or
 * {@link snake}, then reshape it with {@link insert} (priority or
 * compensation picks) and {@link trade} (picks changing hands). Each pick
 * remembers the round it belongs to and the team it was first allotted to.
 *
 * A team may hold a **claim** on a player (a territorial, academy or legacy
 * pick, say). When another team selects a claimed player, that is a bid, and
 * the claiming team is asked whether to match it. A match gives the claiming
 * team the player at the bid's pick; the bidding team's pick and every later
 * one move back a place, and the bidding team chooses again. What a match
 * costs is the draft's {@link Matching} rule: free ({@link matchFree}), the
 * claiming team's next pick ({@link matchByForfeit}), or a points bill paid
 * with later picks ({@link matchWithPoints}).
 *
 * A team may pass, forfeiting its remaining picks.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import * as Choice from "./Choice.ts";

// --- Picks -------------------------------------------------------------------

/**
 * A pick, which keeps its identity as it moves through the order.
 *
 * @since 0.1.0
 */
export interface Pick {
  /** The round the pick belongs to. */
  readonly round: number;
  /** The team the pick was first allotted to. */
  readonly originalTeam: Choice.ActorId;
  /** The team that holds the pick. */
  readonly team: Choice.ActorId;
  /** What kind of pick it is, such as `"Regular"` or `"Priority"`. */
  readonly kind: string;
}

/**
 * The same `order` of teams in every one of `rounds` rounds.
 *
 * @since 0.1.0
 */
export const linear = (order: ReadonlyArray<Choice.ActorId>, rounds: number): ReadonlyArray<Pick> =>
  Arr.flatMap(Arr.range(1, Math.max(1, rounds)), (round) =>
    Arr.map(order, (team): Pick => ({ round, originalTeam: team, team, kind: "Regular" })),
  );

/**
 * `order` in odd rounds and its reverse in even rounds, for `rounds` rounds.
 *
 * @since 0.1.0
 */
export const snake = (order: ReadonlyArray<Choice.ActorId>, rounds: number): ReadonlyArray<Pick> =>
  Arr.flatMap(Arr.range(1, Math.max(1, rounds)), (round) =>
    Arr.map(round % 2 === 1 ? order : Arr.reverse(order), (team): Pick => ({
      round,
      originalTeam: team,
      team,
      kind: "Regular",
    })),
  );

/**
 * `picks` with `inserted` placed before the pick at `index` (from 0); an
 * index past the end appends them.
 *
 * @since 0.1.0
 */
export const insert = (
  picks: ReadonlyArray<Pick>,
  index: number,
  inserted: ReadonlyArray<Pick>,
): ReadonlyArray<Pick> => [...Arr.take(picks, index), ...inserted, ...Arr.drop(picks, index)];

/**
 * A draft that cannot be run: a pick traded that does not exist, a claimed
 * player not in the pool.
 *
 * @since 0.1.0
 */
export class InvalidDraft extends Schema.TaggedError<
  InvalidDraft,
  { readonly brand: unique symbol }
>()("InvalidDraft", {
  /** Why the draft cannot be run. */
  reason: Schema.String,
}) {}

/**
 * `picks` with the first pick matching `which` handed to `team`. Fails with
 * {@link InvalidDraft} when no pick matches.
 *
 * @since 0.1.0
 */
export const trade = (
  picks: ReadonlyArray<Pick>,
  which: (pick: Pick) => boolean,
  team: Choice.ActorId,
): Effect.Effect<ReadonlyArray<Pick>, InvalidDraft> =>
  Option.match(Arr.findFirstIndex(picks, which), {
    onNone: () => Effect.fail(new InvalidDraft({ reason: `no such pick to trade to ${team}` })),
    onSome: (i) =>
      Effect.succeed(Arr.map(picks, (pick, j): Pick => (j === i ? { ...pick, team } : pick))),
  });

// --- Claims and matching -----------------------------------------------------

/**
 * A team's claim on a player, which lets it match other teams' bids for them.
 *
 * @since 0.1.0
 */
export interface Claim {
  /** The claimed player. */
  readonly player: Choice.AlternativeId;
  /** The claiming team. */
  readonly team: Choice.ActorId;
  /** The kind of claim, such as `"Academy"`. */
  readonly kind: string;
}

/**
 * A pick still to be used, with its overall number.
 *
 * @since 0.1.0
 */
export interface NumberedPick {
  /** The pick. */
  readonly pick: Pick;
  /** Its overall pick number. */
  readonly number: number;
}

/**
 * A pick that slid back in the order after paying part of a matched bid.
 *
 * @since 0.1.0
 */
export interface Slide {
  /** The pick's overall number before it slid. */
  readonly from: number;
  /** The pick's overall number after it slid. */
  readonly to: number;
}

/**
 * What a team paid to match a bid.
 *
 * @since 0.1.0
 */
export interface Payment {
  /** The matching team. */
  readonly team: Choice.ActorId;
  /** The player the team matched a bid for. */
  readonly player: Choice.AlternativeId;
  /** What was owed, in the matching rule's units. */
  readonly cost: number;
  /** The overall numbers (at the time) of the picks surrendered. */
  readonly surrendered: ReadonlyArray<number>;
  /** The pick that finished the payment, if one slid back. */
  readonly slid: Option.Option<Slide>;
  /** What was still owed once the team's picks ran out. */
  readonly deficit: number;
}

/**
 * What a matching rule decided: the picks left, and what was paid.
 *
 * @since 0.1.0
 */
export interface Settlement {
  /** The picks still to be used, in order, after payment. */
  readonly picks: ReadonlyArray<Pick>;
  /** The overall numbers of the picks surrendered. */
  readonly surrendered: ReadonlyArray<number>;
  /** The pick that slid back, if one did. */
  readonly slid: Option.Option<Slide>;
  /** What was still owed once the team's picks ran out. */
  readonly deficit: number;
}

/**
 * What matching a bid costs, and how it is paid.
 *
 * @since 0.1.0
 */
export interface Matching {
  /** What matching a bid made with the pick numbered `number` costs. */
  readonly cost: (number: number) => number;
  /** What the team can pay with `picks`: the value of its picks after the one on the clock. */
  readonly budget: (picks: ReadonlyArray<NumberedPick>, team: Choice.ActorId) => number;
  /**
   * Pays `cost` for `team` from `picks`, the picks after the one on the clock,
   * numbered from the next selection.
   */
  readonly pay: (
    picks: ReadonlyArray<NumberedPick>,
    team: Choice.ActorId,
    cost: number,
  ) => Settlement;
}

const unchanged = (picks: ReadonlyArray<NumberedPick>): ReadonlyArray<Pick> =>
  Arr.map(picks, (entry) => entry.pick);

/**
 * Matching costs nothing.
 *
 * @since 0.1.0
 */
export const matchFree: Matching = {
  cost: () => 0,
  budget: () => 0,
  pay: (picks) => ({ picks: unchanged(picks), surrendered: [], slid: Option.none(), deficit: 0 }),
};

/**
 * Matching costs the matching team its next pick; with none left, a deficit
 * of one pick.
 *
 * @since 0.1.0
 */
export const matchByForfeit: Matching = {
  cost: () => 1,
  budget: (picks, team) => Arr.filter(picks, (entry) => entry.pick.team === team).length,
  pay: (picks, team) =>
    Option.match(
      Arr.findFirst(picks, (entry) => entry.pick.team === team),
      {
        onNone: () => ({
          picks: unchanged(picks),
          surrendered: [],
          slid: Option.none(),
          deficit: 1,
        }),
        onSome: (next) => ({
          picks: unchanged(Arr.filter(picks, (entry) => entry !== next)),
          surrendered: [next.number],
          slid: Option.none(),
          deficit: 0,
        }),
      },
    ),
};

/**
 * Matching costs `points(number)` of the bid's pick, less `discount` (a share
 * from 0 to 1), rounded to the nearest point, and is paid with the matching
 * team's later picks in order: each pick worth no more than what is still
 * owed is surrendered; the pick that finishes the payment slides back to the
 * first place, no earlier than it was, worth no more than its remaining
 * points; anything still owed once the team's picks run out is a deficit.
 *
 * @since 0.1.0
 */
export const matchWithPoints = (options: {
  /** The points value of each overall pick number. */
  readonly points: (number: number) => number;
  /** The share of a bid's value the matching team is excused. Defaults to `0`. */
  readonly discount?: number;
}): Matching => {
  const { points } = options;
  const discount = options.discount ?? 0;
  return {
    cost: (number) => Math.round(points(number) * (1 - discount)),
    budget: (picks, team) =>
      Arr.reduce(picks, 0, (sum, entry) =>
        entry.pick.team === team ? sum + points(entry.number) : sum,
      ),
    pay: (picks, team, cost) => {
      interface Paying {
        readonly owed: number;
        readonly surrendered: ReadonlyArray<NumberedPick>;
        readonly slide: Option.Option<{ readonly entry: NumberedPick; readonly left: number }>;
      }
      const start: Paying = { owed: cost, surrendered: [], slide: Option.none() };
      const paid = Arr.reduce(
        Arr.filter(picks, (entry) => entry.pick.team === team),
        start,
        (acc, entry): Paying => {
          const value = points(entry.number);
          return acc.owed <= 0
            ? acc
            : value <= acc.owed
              ? { ...acc, owed: acc.owed - value, surrendered: Arr.append(acc.surrendered, entry) }
              : { ...acc, owed: 0, slide: Option.some({ entry, left: value - acc.owed }) };
        },
      );
      const base = Option.match(Arr.head(picks), {
        onNone: () => 0,
        onSome: (first) => first.number,
      });
      const kept = Arr.filter(
        picks,
        (entry) =>
          !Arr.contains(paid.surrendered, entry) &&
          !Option.exists(paid.slide, (s) => s.entry === entry),
      );
      return Option.match(paid.slide, {
        onNone: () => ({
          picks: unchanged(kept),
          surrendered: Arr.map(paid.surrendered, (s) => s.number),
          slid: Option.none(),
          deficit: paid.owed,
        }),
        onSome: ({ entry, left }) => {
          const index = Option.getOrElse(
            Arr.findFirstIndex(
              kept,
              (_entry, i) => base + i >= entry.number && points(base + i) <= left,
            ),
            () => kept.length,
          );
          return {
            picks: insert(unchanged(kept), index, [entry.pick]),
            surrendered: Arr.map(paid.surrendered, (s) => s.number),
            slid: Option.some({ from: entry.number, to: base + index }),
            deficit: 0,
          };
        },
      });
    },
  };
};

// --- The draft ---------------------------------------------------------------

/**
 * The draft to run.
 *
 * @since 0.1.0
 */
export interface Draft {
  /** The picks, in order. */
  readonly picks: ReadonlyArray<Pick>;
  /** The players available, in no particular order. */
  readonly players: ReadonlyArray<Choice.AlternativeId>;
  /** Teams' claims on players. */
  readonly claims?: ReadonlyArray<Claim>;
  /** What matching a bid on a claimed player costs. Defaults to {@link matchFree}. */
  readonly matching?: Matching;
}

/**
 * What a team on the clock, or a team whose claimed player has been bid on,
 * is asked.
 *
 * @since 0.1.0
 */
export type Prompt = Data.TaggedEnum<{
  /** The team is on the clock. */
  Select: {
    /** The overall pick number. */
    readonly number: number;
    /** The pick being used. */
    readonly pick: Pick;
    /** The players still available. */
    readonly available: ReadonlyArray<Choice.AlternativeId>;
  };
  /** Another team has bid on a player the team claims. */
  Match: {
    /** The claimed player. */
    readonly player: Choice.AlternativeId;
    /** The bidding team. */
    readonly bidder: Choice.ActorId;
    /** The overall number of the bid's pick. */
    readonly number: number;
    /** What matching would cost. */
    readonly cost: number;
    /** What the team can pay with its remaining picks. */
    readonly budget: number;
  };
}>;

/**
 * Constructors and matchers for {@link Prompt}.
 *
 * @since 0.1.0
 */
export const Prompt = Data.taggedEnum<Prompt>();

/**
 * A team's answer.
 *
 * @since 0.1.0
 */
export type Response = Data.TaggedEnum<{
  /** Select `player` with the pick on the clock. */
  Select: {
    /** The player selected. */
    readonly player: Choice.AlternativeId;
  };
  /** Pass, forfeiting the team's remaining picks. */
  Pass: {};
  /** Match the bid on the team's claimed player. */
  Match: {};
  /** Let the bidding team have the claimed player. */
  Decline: {};
}>;

/**
 * Constructors and matchers for {@link Response}: `Response.Select({ player })`,
 * `Response.Pass()`, `Response.Match()`, `Response.Decline()`.
 *
 * @since 0.1.0
 */
export const Response = Data.taggedEnum<Response>();

/**
 * An answer the draft's rules do not allow: an unavailable player, a match
 * with no bid to match.
 *
 * @since 0.1.0
 */
export class InvalidResponse extends Schema.TaggedError<
  InvalidResponse,
  { readonly brand: unique symbol }
>()("InvalidResponse", {
  /** The team that answered. */
  team: Schema.String,
  /** Why the answer is not allowed. */
  reason: Schema.String,
}) {}

/**
 * A player drafted.
 *
 * @since 0.1.0
 */
export interface Selection {
  /** The overall pick number. */
  readonly number: number;
  /** The round the selection was made in. */
  readonly round: number;
  /** The team that drafted the player. */
  readonly team: Choice.ActorId;
  /** The player drafted. */
  readonly player: Choice.AlternativeId;
  /** The team whose bid the drafting team matched, for a matched claim. */
  readonly matchedBidBy: Option.Option<Choice.ActorId>;
}

/**
 * The completed draft.
 *
 * @since 0.1.0
 */
export interface Result {
  /** Every selection, in order. */
  readonly selections: ReadonlyArray<Selection>;
  /** The players nobody drafted. */
  readonly undrafted: ReadonlyArray<Choice.AlternativeId>;
  /** Every matched bid's payment, in order. */
  readonly payments: ReadonlyArray<Payment>;
  /** Each team's carried deficit, for teams that have one. */
  readonly deficits: Readonly<Record<Choice.ActorId, number>>;
}

/**
 * A bid on a claimed player, awaiting the claiming team's answer.
 *
 * @since 0.1.0
 */
export interface PendingBid {
  /** The claimed player bid on. */
  readonly player: Choice.AlternativeId;
  /** The claim the bid is against. */
  readonly claim: Claim;
  /** What matching would cost. */
  readonly cost: number;
}

/**
 * A draft in progress: the protocol's state.
 *
 * @since 0.1.0
 */
export interface State {
  /** The draft being run. */
  readonly draft: Draft;
  /** The picks still to be used, the one on the clock first. */
  readonly picks: ReadonlyArray<Pick>;
  /** The players still available. */
  readonly available: ReadonlyArray<Choice.AlternativeId>;
  /** The selections so far. */
  readonly selections: ReadonlyArray<Selection>;
  /** The matched bids' payments so far. */
  readonly payments: ReadonlyArray<Payment>;
  /** A bid awaiting the claiming team's answer. */
  readonly bid: Option.Option<PendingBid>;
}

const matchingOf = (draft: Draft) => draft.matching ?? matchFree;

const onTheClock = (state: State): number => state.selections.length + 1;

/** The picks after the one on the clock, numbered. */
const laterPicks = (state: State): ReadonlyArray<NumberedPick> =>
  Arr.map(Arr.drop(state.picks, 1), (pick, index) => ({
    pick,
    number: onTheClock(state) + 1 + index,
  }));

/**
 * Starts `draft`: validates it.
 *
 * @since 0.1.0
 */
export const start = (draft: Draft): Effect.Effect<State, InvalidDraft> => {
  const claims = draft.claims ?? [];
  if (!Arr.every(claims, (claim) => Arr.contains(draft.players, claim.player))) {
    return Effect.fail(new InvalidDraft({ reason: "every claimed player must be in the pool" }));
  }
  if (Arr.dedupe(Arr.map(claims, (claim) => claim.player)).length !== claims.length) {
    return Effect.fail(new InvalidDraft({ reason: "a player is claimed twice" }));
  }
  return Effect.succeed({
    draft,
    picks: draft.picks,
    available: Arr.dedupe(draft.players),
    selections: [],
    payments: [],
    bid: Option.none(),
  });
};

const select = (
  state: State,
  pick: Pick,
  player: Choice.AlternativeId,
  team: Choice.ActorId,
  matchedBidBy: Option.Option<Choice.ActorId>,
): State => ({
  ...state,
  available: Arr.filter(state.available, (p) => p !== player),
  selections: Arr.append(state.selections, {
    number: onTheClock(state),
    round: pick.round,
    team,
    player,
    matchedBidBy,
  }),
});

const invalid = (team: Choice.ActorId, reason: string) =>
  Effect.fail(new InvalidResponse({ team, reason }));

/** The claiming team takes the player at the bid's pick and pays for it. */
const matchBid = (state: State, pick: Pick, bid: PendingBid): State => {
  const selected = select(state, pick, bid.player, bid.claim.team, Option.some(pick.team));
  const settlement = matchingOf(state.draft).pay(laterPicks(selected), bid.claim.team, bid.cost);
  return {
    ...selected,
    bid: Option.none(),
    picks: [pick, ...settlement.picks],
    payments: Arr.append(state.payments, {
      team: bid.claim.team,
      player: bid.player,
      cost: bid.cost,
      surrendered: settlement.surrendered,
      slid: settlement.slid,
      deficit: settlement.deficit,
    }),
  };
};

const respondToBid = (
  state: State,
  pick: Pick,
  bid: PendingBid,
  response: Response,
): Effect.Effect<State, InvalidResponse> =>
  Response.$match(response, {
    Match: () => Effect.succeed(matchBid(state, pick, bid)),
    Decline: () =>
      Effect.succeed({
        ...select(state, pick, bid.player, pick.team, Option.none()),
        picks: Arr.drop(state.picks, 1),
        bid: Option.none(),
      }),
    Select: () =>
      invalid(bid.claim.team, "a bid on the team's claimed player awaits a match or decline"),
    Pass: () =>
      invalid(bid.claim.team, "a bid on the team's claimed player awaits a match or decline"),
  });

const respondOnTheClock = (
  state: State,
  pick: Pick,
  response: Response,
): Effect.Effect<State, InvalidResponse> =>
  Response.$match(response, {
    Select: ({ player }) => {
      if (!Arr.contains(state.available, player)) {
        return invalid(pick.team, `player ${player} is not available`);
      }
      const claim = Arr.findFirst(
        state.draft.claims ?? [],
        (c) => c.player === player && c.team !== pick.team,
      );
      return Effect.succeed(
        Option.match(claim, {
          onNone: (): State => ({
            ...select(state, pick, player, pick.team, Option.none()),
            picks: Arr.drop(state.picks, 1),
          }),
          onSome: (c): State => ({
            ...state,
            bid: Option.some({
              player,
              claim: c,
              cost: matchingOf(state.draft).cost(onTheClock(state)),
            }),
          }),
        }),
      );
    },
    Pass: () =>
      Effect.succeed({
        ...state,
        picks: Arr.filter(state.picks, (p) => p.team !== pick.team),
      }),
    Match: () => invalid(pick.team, "there is no bid to match or decline"),
    Decline: () => invalid(pick.team, "there is no bid to match or decline"),
  });

/**
 * The draft as a sequential {@link Choice.Protocol}.
 *
 * @since 0.1.0
 */
export const protocol: Choice.Protocol<State, Prompt, Response, Result, InvalidResponse> = {
  name: "Draft",
  next: (state) =>
    Option.match(state.bid, {
      onSome: (bid): Option.Option<Choice.Turn<Prompt>> =>
        Option.map(Arr.head(state.picks), (pick) => ({
          actor: bid.claim.team,
          prompt: Prompt.Match({
            player: bid.player,
            bidder: pick.team,
            number: onTheClock(state),
            cost: bid.cost,
            budget: matchingOf(state.draft).budget(laterPicks(state), bid.claim.team),
          }),
        })),
      onNone: () =>
        Arr.isReadonlyArrayEmpty(state.available)
          ? Option.none()
          : Option.map(Arr.head(state.picks), (pick) => ({
              actor: pick.team,
              prompt: Prompt.Select({
                number: onTheClock(state),
                pick,
                available: state.available,
              }),
            })),
    }),
  respond: (state, response) =>
    Option.match(Arr.head(state.picks), {
      onNone: () => Effect.succeed(state),
      onSome: (pick) =>
        Option.match(state.bid, {
          onSome: (bid) => respondToBid(state, pick, bid, response),
          onNone: () => respondOnTheClock(state, pick, response),
        }),
    }),
  finish: (state) => ({
    selections: state.selections,
    undrafted: state.available,
    payments: state.payments,
    deficits: R.filter(
      Arr.reduce(state.payments, R.empty<Choice.ActorId, number>(), (all, payment) => ({
        ...all,
        [payment.team]: (all[payment.team] ?? 0) + payment.deficit,
      })),
      (deficit) => deficit > 0,
    ),
  }),
};

/**
 * Runs `draft` to the end, asking `agent` each team's choices.
 *
 * @since 0.1.0
 */
export const run = <E, R>(
  draft: Draft,
  agent: Choice.Agent<Prompt, Response, E, R>,
): Effect.Effect<Result, InvalidDraft | InvalidResponse | E, R> =>
  Effect.flatMap(start(draft), (state) => Choice.play(protocol, state, agent));

/**
 * An {@link Choice.Agent} for every team that drafts from a ranking of
 * players, best first: each team takes its highest-ranked available player
 * (passing once none of its ranking is left), and decides whether to match a
 * bid with `match`, which by default matches whenever the team's remaining
 * picks cover the cost.
 *
 * @since 0.1.0
 */
export const byRanking =
  (
    ranking: (team: Choice.ActorId) => ReadonlyArray<Choice.AlternativeId>,
    match: (team: Choice.ActorId, prompt: Data.TaggedEnum.Value<Prompt, "Match">) => boolean = (
      _team,
      prompt,
    ) => prompt.budget >= prompt.cost,
  ): Choice.Agent<Prompt, Response> =>
  (turn) =>
    Effect.succeed(
      Prompt.$match(turn.prompt, {
        Match: (prompt) => (match(turn.actor, prompt) ? Response.Match() : Response.Decline()),
        Select: ({ available }) =>
          Option.match(
            Arr.findFirst(ranking(turn.actor), (player) => Arr.contains(available, player)),
            {
              onNone: () => Response.Pass(),
              onSome: (player) => Response.Select({ player }),
            },
          ),
      }),
    );
