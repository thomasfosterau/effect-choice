/**
 * The AFL national draft, as a sequential {@link Choice.Protocol}: clubs
 * (actors) take turns choosing players (alternatives).
 *
 * - **Order**: {@link draftOrder} ranks clubs that missed the finals in
 *   reverse ladder order, then finalists by the week they were knocked out
 *   (reverse ladder order within a week), the runner-up and, last, the
 *   premier. The same order repeats each round.
 * - **Priority picks** granted by the AFL Commission sit at the start of the
 *   first round, or at the end of the first or second round.
 * - **Traded picks** keep their place in the order and change owner.
 * - **Father-son and academy bids**: when a club selects a player another club
 *   has nominated, that is a bid. The nominating club may match it: the player
 *   joins the nominating club at the bid's pick, the bidding club's pick (and
 *   every later one) moves back one place, and the bidding club chooses again.
 *   The nominating club pays the bid pick's points value less a discount
 *   (20 per cent by default) with its next picks in order: picks worth less
 *   than what is still owed are surrendered; the pick that finishes the
 *   payment slides back to the place its remaining points are worth; and
 *   anything still owed once its picks run out is a deficit, carried to its
 *   next draft.
 * - A club may **pass**, which forfeits its remaining picks.
 *
 * The points values default to {@link draftValueIndex}, the AFL's draft
 * value index as introduced in 2015; pass your own `points` table for other
 * years' values.
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

// --- The draft order ---------------------------------------------------------

/**
 * How a season ended: the order in which the draft's first round runs is
 * derived from it.
 *
 * @since 0.1.0
 */
export interface Season {
  /** The final home-and-away ladder, first place first. */
  readonly ladder: ReadonlyArray<Choice.ActorId>;
  /** The clubs that lost an elimination final (week one). */
  readonly eliminationFinalLosers: ReadonlyArray<Choice.ActorId>;
  /** The clubs that lost a semi-final (week two). */
  readonly semiFinalLosers: ReadonlyArray<Choice.ActorId>;
  /** The clubs that lost a preliminary final (week three). */
  readonly preliminaryFinalLosers: ReadonlyArray<Choice.ActorId>;
  /** The grand final's loser. */
  readonly runnerUp: Choice.ActorId;
  /** The grand final's winner. */
  readonly premier: Choice.ActorId;
}

/**
 * A draft that cannot be run: an inconsistent season, a pick traded that
 * does not exist, a nominated player not in the pool.
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
 * The order in which clubs pick in each round, worst-performed first.
 *
 * Fails with {@link InvalidDraft} when a finalist is missing from the
 * ladder, or a club appears more than once among the finalists.
 *
 * @since 0.1.0
 */
export const draftOrder = (
  season: Season,
): Effect.Effect<ReadonlyArray<Choice.ActorId>, InvalidDraft> => {
  const finalists = [
    ...season.eliminationFinalLosers,
    ...season.semiFinalLosers,
    ...season.preliminaryFinalLosers,
    season.runnerUp,
    season.premier,
  ];
  const reverseLadder = Arr.reverse(season.ladder);
  const inReverseLadderOrder = (clubs: ReadonlyArray<Choice.ActorId>) =>
    Arr.filter(reverseLadder, (club) => Arr.contains(clubs, club));
  if (Arr.dedupe(finalists).length !== finalists.length) {
    return Effect.fail(new InvalidDraft({ reason: "a club is listed among the finalists twice" }));
  }
  if (!Arr.every(finalists, (club) => Arr.contains(season.ladder, club))) {
    return Effect.fail(new InvalidDraft({ reason: "every finalist must be on the ladder" }));
  }
  return Effect.succeed([
    ...Arr.filter(reverseLadder, (club) => !Arr.contains(finalists, club)),
    ...inReverseLadderOrder(season.eliminationFinalLosers),
    ...inReverseLadderOrder(season.semiFinalLosers),
    ...inReverseLadderOrder(season.preliminaryFinalLosers),
    season.runnerUp,
    season.premier,
  ]);
};

// --- Points ------------------------------------------------------------------

const dvi2015: ReadonlyArray<number> = [
  3000, 2517, 2234, 2034, 1878, 1751, 1644, 1551, 1469, 1395, 1329, 1268, 1212, 1161, 1112, 1067,
  1025, 985, 948, 912, 878, 845, 815, 785, 756, 729, 703, 677, 653, 629, 606, 584, 563, 542, 522,
  502, 483, 465, 446, 429, 412, 395, 378, 362, 347, 331, 316, 302, 287, 273, 259, 246, 233, 220,
  207, 194, 182, 170, 158, 146, 135, 123, 112, 101, 90, 80, 69, 59, 49, 39, 29, 19, 9,
];

/**
 * The points value of the pick at `number` (from 1) in the AFL's draft value
 * index as introduced in 2015: 3,000 points for pick 1, falling to 9 for
 * pick 73 and 0 thereafter.
 *
 * @since 0.1.0
 */
export const draftValueIndex = (number: number): number =>
  Option.getOrElse(Arr.get(dvi2015, number - 1), () => 0);

// --- The draft ---------------------------------------------------------------

/**
 * When the AFL Commission's priority pick falls.
 *
 * @since 0.1.0
 */
export type Placement = "StartOfFirstRound" | "EndOfFirstRound" | "EndOfSecondRound";

/**
 * A priority pick granted to a club.
 *
 * @since 0.1.0
 */
export interface PriorityPick {
  /** The club granted the pick. */
  readonly club: Choice.ActorId;
  /** Where the pick falls. */
  readonly placement: Placement;
}

/**
 * A traded pick: the `round` pick that `originalClub` was allotted now
 * belongs to `club`.
 *
 * @since 0.1.0
 */
export interface Trade {
  /** The round of the pick. */
  readonly round: number;
  /** The club the pick was allotted to by the draft order. */
  readonly originalClub: Choice.ActorId;
  /** The club that now holds it. */
  readonly club: Choice.ActorId;
}

/**
 * Why a club holds a claim on a player before the draft.
 *
 * @since 0.1.0
 */
export type NominationKind = "FatherSon" | "Academy" | "NextGenerationAcademy";

/**
 * A club's nomination of a father-son or academy player, which lets it match
 * other clubs' bids for them.
 *
 * @since 0.1.0
 */
export interface Nomination {
  /** The nominated player. */
  readonly player: Choice.AlternativeId;
  /** The nominating club. */
  readonly club: Choice.ActorId;
  /** The club's claim on the player. */
  readonly kind: NominationKind;
}

/**
 * The draft to run.
 *
 * @since 0.1.0
 */
export interface Draft {
  /** The order clubs pick in each round, as {@link draftOrder} derives it. */
  readonly order: ReadonlyArray<Choice.ActorId>;
  /** The number of rounds. */
  readonly rounds: number;
  /** The players available, in no particular order. */
  readonly players: ReadonlyArray<Choice.AlternativeId>;
  /** Priority picks; several at the same placement fall in draft order. */
  readonly priorityPicks?: ReadonlyArray<PriorityPick>;
  /** Traded picks, applied in order. */
  readonly trades?: ReadonlyArray<Trade>;
  /** Father-son and academy nominations. */
  readonly nominations?: ReadonlyArray<Nomination>;
  /** The points value of each pick number. Defaults to {@link draftValueIndex}. */
  readonly points?: (number: number) => number;
  /** The share of a bid's points value a matching club is excused, from 0 to 1. Defaults to `0.2`. */
  readonly discount?: number;
}

/**
 * A pick, which keeps its identity as it moves through the order.
 *
 * @since 0.1.0
 */
export interface Pick {
  /** The round the pick belongs to. */
  readonly round: number;
  /** The club the draft order (or a priority grant) allotted the pick to. */
  readonly originalClub: Choice.ActorId;
  /** The club that holds the pick. */
  readonly club: Choice.ActorId;
  /** Whether the pick is a priority pick. */
  readonly priority: boolean;
}

/**
 * What a club on the clock, or a club whose nominee has been bid on, is
 * asked.
 *
 * @since 0.1.0
 */
export type Prompt = Data.TaggedEnum<{
  /** The club is on the clock. */
  Select: {
    /** The overall pick number. */
    readonly number: number;
    /** The pick being used. */
    readonly pick: Pick;
    /** The players still available. */
    readonly available: ReadonlyArray<Choice.AlternativeId>;
  };
  /** Another club has bid on the club's nominee. */
  Match: {
    /** The nominee. */
    readonly player: Choice.AlternativeId;
    /** The bidding club. */
    readonly bidder: Choice.ActorId;
    /** The overall number of the bid's pick. */
    readonly number: number;
    /** The points matching would cost, after the discount. */
    readonly cost: number;
    /** The points value of the club's own remaining picks. */
    readonly points: number;
  };
}>;

/**
 * Constructors and matchers for {@link Prompt}.
 *
 * @since 0.1.0
 */
export const Prompt = Data.taggedEnum<Prompt>();

/**
 * A club's answer.
 *
 * @since 0.1.0
 */
export type Response = Data.TaggedEnum<{
  /** Select `player` with the pick on the clock. */
  Select: {
    /** The player selected. */
    readonly player: Choice.AlternativeId;
  };
  /** Pass, forfeiting the club's remaining picks. */
  Pass: {};
  /** Match the bid on the club's nominee. */
  Match: {};
  /** Let the bidding club have the nominee. */
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
  /** The club that answered. */
  club: Schema.String,
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
  /** The club that drafted the player. */
  readonly club: Choice.ActorId;
  /** The player drafted. */
  readonly player: Choice.AlternativeId;
  /** The club whose bid the drafting club matched, for a matched father-son or academy bid. */
  readonly matchedBidBy: Option.Option<Choice.ActorId>;
}

/**
 * A pick that slid back in the order after part of its points paid for a
 * matched bid.
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
 * What a club paid to match a bid.
 *
 * @since 0.1.0
 */
export interface Payment {
  /** The matching club. */
  readonly club: Choice.ActorId;
  /** The player the club matched a bid for. */
  readonly player: Choice.AlternativeId;
  /** The points owed. */
  readonly cost: number;
  /** The overall numbers (at the time) of the picks surrendered. */
  readonly surrendered: ReadonlyArray<number>;
  /** The pick that finished the payment, if one slid back: its number before and after. */
  readonly slid: Option.Option<Slide>;
  /** The points still owed when the club's picks ran out. */
  readonly deficit: number;
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
  /** Each club's carried points deficit, for clubs that have one. */
  readonly deficits: Readonly<Record<Choice.ActorId, number>>;
}

/**
 * A bid on a nominated player, awaiting the nominating club's answer.
 *
 * @since 0.1.0
 */
export interface PendingBid {
  /** The nominated player bid on. */
  readonly player: Choice.AlternativeId;
  /** The nomination the bid is against. */
  readonly nominee: Nomination;
  /** The points matching would cost, after the discount. */
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
  /** A bid awaiting the nominating club's answer. */
  readonly bid: Option.Option<PendingBid>;
}

const pointsOf = (draft: Draft) => draft.points ?? draftValueIndex;

const onTheClock = (state: State): number => state.selections.length + 1;

/** The picks in order, before any selection. */
const allot = (draft: Draft): Effect.Effect<ReadonlyArray<Pick>, InvalidDraft> => {
  const priority = (placement: Placement, round: number) =>
    Arr.map(
      Arr.filter(draft.order, (club) =>
        Arr.some(draft.priorityPicks ?? [], (p) => p.club === club && p.placement === placement),
      ),
      (club): Pick => ({ round, originalClub: club, club, priority: true }),
    );
  const picks = Arr.flatMap(Arr.range(1, Math.max(1, draft.rounds)), (round) => [
    ...(round === 1 ? priority("StartOfFirstRound", 1) : []),
    ...Arr.map(draft.order, (club): Pick => ({ round, originalClub: club, club, priority: false })),
    ...(round === 1 ? priority("EndOfFirstRound", 1) : []),
    ...(round === 2 ? priority("EndOfSecondRound", 2) : []),
  ]);
  return Effect.reduce(
    draft.trades ?? [],
    () => picks,
    (current, trade) => {
      const index = Arr.findFirstIndex(
        current,
        (pick) =>
          !pick.priority && pick.round === trade.round && pick.originalClub === trade.originalClub,
      );
      return Option.match(index, {
        onNone: () =>
          Effect.fail(
            new InvalidDraft({
              reason: `no round ${trade.round} pick allotted to ${trade.originalClub} to trade`,
            }),
          ),
        onSome: (i) =>
          Effect.succeed(
            Arr.map(current, (pick, j): Pick => (j === i ? { ...pick, club: trade.club } : pick)),
          ),
      });
    },
  );
};

/**
 * Starts `draft`: validates it and allots its picks.
 *
 * @since 0.1.0
 */
export const start = (draft: Draft): Effect.Effect<State, InvalidDraft> =>
  Effect.gen(function* () {
    if (!Number.isInteger(draft.rounds) || draft.rounds < 1) {
      return yield* new InvalidDraft({ reason: "rounds must be a positive integer" });
    }
    if (Arr.dedupe(draft.order).length !== draft.order.length) {
      return yield* new InvalidDraft({ reason: "a club appears twice in the draft order" });
    }
    const nominations = draft.nominations ?? [];
    if (!Arr.every(nominations, (n) => Arr.contains(draft.players, n.player))) {
      return yield* new InvalidDraft({ reason: "every nominated player must be in the pool" });
    }
    if (Arr.dedupe(Arr.map(nominations, (n) => n.player)).length !== nominations.length) {
      return yield* new InvalidDraft({ reason: "a player is nominated twice" });
    }
    const discount = draft.discount ?? 0.2;
    if (!(discount >= 0 && discount <= 1)) {
      return yield* new InvalidDraft({ reason: "the discount must be between 0 and 1" });
    }
    const picks = yield* allot(draft);
    return {
      draft,
      picks,
      available: Arr.dedupe(draft.players),
      selections: [],
      payments: [],
      bid: Option.none(),
    };
  });

const select = (
  state: State,
  pick: Pick,
  player: Choice.AlternativeId,
  club: Choice.ActorId,
  matchedBidBy: Option.Option<Choice.ActorId>,
): State => ({
  ...state,
  available: Arr.filter(state.available, (p) => p !== player),
  selections: Arr.append(state.selections, {
    number: onTheClock(state),
    round: pick.round,
    club,
    player,
    matchedBidBy,
  }),
});

/**
 * Pays `cost` points with `club`'s picks after the one on the clock, in
 * order, from a state whose next selection is numbered `base`.
 */
const pay = (
  state: State,
  club: Choice.ActorId,
  player: Choice.AlternativeId,
  cost: number,
): State => {
  const points = pointsOf(state.draft);
  const base = onTheClock(state);
  // The pick on the clock is the bidder's; the club pays with the rest.
  const numbered = Arr.map(state.picks, (pick, index) => ({ pick, number: base + index }));
  const own = Arr.filter(Arr.drop(numbered, 1), (entry) => entry.pick.club === club);
  type Paying = {
    readonly owed: number;
    readonly surrendered: ReadonlyArray<(typeof own)[number]>;
    readonly slide: Option.Option<{ readonly entry: (typeof own)[number]; readonly left: number }>;
  };
  const paid = Arr.reduce(
    own,
    ((): Paying => ({ owed: cost, surrendered: [], slide: Option.none() }))(),
    (acc, entry): Paying => {
      const value = points(entry.number);
      return acc.owed <= 0
        ? acc
        : value <= acc.owed
          ? { ...acc, owed: acc.owed - value, surrendered: Arr.append(acc.surrendered, entry) }
          : { ...acc, owed: 0, slide: Option.some({ entry, left: value - acc.owed }) };
    },
  );
  const removed = (entry: (typeof numbered)[number]) =>
    Arr.some(paid.surrendered, (s) => s.pick === entry.pick) ||
    Option.exists(paid.slide, (s) => s.entry.pick === entry.pick);
  const kept = Arr.filter(numbered, (entry) => !removed(entry));
  const placed = Option.match(paid.slide, {
    onNone: () => ({ picks: Arr.map(kept, (e) => e.pick), slid: Option.none() }),
    onSome: ({ entry, left }) => {
      // The pick lands at the first place, no earlier than it was, whose value
      // is no more than its remaining points.
      const after = Arr.findFirstIndex(
        kept,
        (_entry, index) => base + index >= entry.number && points(base + index) <= left,
      );
      const index = Option.getOrElse(after, () => kept.length);
      return {
        picks: Arr.insertAt(
          Arr.map(kept, (e) => e.pick),
          index,
          entry.pick,
        ).pipe(
          Option.getOrElse(() =>
            Arr.append(
              Arr.map(kept, (e) => e.pick),
              entry.pick,
            ),
          ),
        ),
        slid: Option.some({ from: entry.number, to: base + index }),
      };
    },
  });
  return {
    ...state,
    picks: placed.picks,
    payments: Arr.append(state.payments, {
      club,
      player,
      cost,
      surrendered: Arr.map(paid.surrendered, (s) => s.number),
      slid: placed.slid,
      deficit: paid.owed,
    }),
  };
};

const invalid = (club: Choice.ActorId, reason: string) =>
  Effect.fail(new InvalidResponse({ club, reason }));

const remainingPoints = (state: State, club: Choice.ActorId): number =>
  Arr.reduce(state.picks, 0, (sum, pick, index) =>
    pick.club === club ? sum + pointsOf(state.draft)(onTheClock(state) + index) : sum,
  );

const respondToBid = (
  state: State,
  pick: Pick,
  bid: PendingBid,
  response: Response,
): Effect.Effect<State, InvalidResponse> => {
  const club = bid.nominee.club;
  return Response.$match(response, {
    Match: () =>
      Effect.succeed(
        pay(
          {
            ...select(state, pick, bid.player, club, Option.some(pick.club)),
            bid: Option.none(),
          },
          club,
          bid.player,
          bid.cost,
        ),
      ),
    Decline: () =>
      Effect.succeed({
        ...select(state, pick, bid.player, pick.club, Option.none()),
        picks: Arr.drop(state.picks, 1),
        bid: Option.none(),
      }),
    Select: () => invalid(club, "a bid on the club's nominee awaits a match or decline"),
    Pass: () => invalid(club, "a bid on the club's nominee awaits a match or decline"),
  });
};

const respondOnTheClock = (
  state: State,
  pick: Pick,
  response: Response,
): Effect.Effect<State, InvalidResponse> =>
  Response.$match(response, {
    Select: ({ player }) => {
      if (!Arr.contains(state.available, player)) {
        return invalid(pick.club, `player ${player} is not available`);
      }
      const nominee = Arr.findFirst(
        state.draft.nominations ?? [],
        (n) => n.player === player && n.club !== pick.club,
      );
      return Effect.succeed(
        Option.match(nominee, {
          onNone: (): State => ({
            ...select(state, pick, player, pick.club, Option.none()),
            picks: Arr.drop(state.picks, 1),
          }),
          onSome: (n): State => ({
            ...state,
            bid: Option.some({
              player,
              nominee: n,
              cost: Math.round(
                pointsOf(state.draft)(onTheClock(state)) * (1 - (state.draft.discount ?? 0.2)),
              ),
            }),
          }),
        }),
      );
    },
    Pass: () =>
      Effect.succeed({
        ...state,
        picks: Arr.filter(state.picks, (p) => p.club !== pick.club),
      }),
    Match: () => invalid(pick.club, "there is no bid to match or decline"),
    Decline: () => invalid(pick.club, "there is no bid to match or decline"),
  });

/**
 * The draft as a sequential {@link Choice.Protocol}.
 *
 * @since 0.1.0
 */
export const protocol: Choice.Protocol<State, Prompt, Response, Result, InvalidResponse> = {
  name: "AflDraft",
  next: (state) =>
    Option.match(state.bid, {
      onSome: (bid): Option.Option<Choice.Turn<Prompt>> =>
        Option.map(Arr.head(state.picks), (pick) => ({
          actor: bid.nominee.club,
          prompt: Prompt.Match({
            player: bid.player,
            bidder: pick.club,
            number: onTheClock(state),
            cost: bid.cost,
            points: remainingPoints(state, bid.nominee.club),
          }),
        })),
      onNone: () =>
        Arr.isReadonlyArrayEmpty(state.available)
          ? Option.none()
          : Option.map(Arr.head(state.picks), (pick) => ({
              actor: pick.club,
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
        [payment.club]: (all[payment.club] ?? 0) + payment.deficit,
      })),
      (deficit) => deficit > 0,
    ),
  }),
};

/**
 * Runs `draft` to the end, asking `agent` each club's choices.
 *
 * @since 0.1.0
 */
export const run = <E, R>(
  draft: Draft,
  agent: Choice.Agent<Prompt, Response, E, R>,
): Effect.Effect<Result, InvalidDraft | InvalidResponse | E, R> =>
  Effect.flatMap(start(draft), (state) => Choice.play(protocol, state, agent));

/**
 * An {@link Choice.Agent} for every club that drafts from a ranking of
 * players, best first: each club takes its highest-ranked available player
 * (passing once none of its ranking is left), and decides whether to match a
 * bid with `match`, which by default matches whenever the club's remaining
 * picks cover the cost.
 *
 * @since 0.1.0
 */
export const byRanking =
  (
    ranking: (club: Choice.ActorId) => ReadonlyArray<Choice.AlternativeId>,
    match: (club: Choice.ActorId, prompt: Data.TaggedEnum.Value<Prompt, "Match">) => boolean = (
      _club,
      prompt,
    ) => prompt.points >= prompt.cost,
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
