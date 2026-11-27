/**
 * The AFL national draft, built on `Draft`: the draft order comes from how
 * the season ended, the AFL Commission's priority picks and clubs' trades
 * reshape it, and father-son and academy bids are matched with points from
 * the draft value index.
 *
 * Simplified: free-agency compensation picks (add them as priority picks),
 * the rookie and mid-season drafts, live trading during the draft, and the
 * limits on which picks may pay for a bid, which change from year to year.
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { type Choice, Draft } from "@thomasfosterau/effect-choice";

/** How a season ended. */
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
 * The order clubs pick in each round: non-finalists in reverse ladder order,
 * then finalists by the week they were knocked out (reverse ladder order
 * within a week), the runner-up and, last, the premier.
 */
export const draftOrder = (
  season: Season,
): Effect.Effect<ReadonlyArray<Choice.ActorId>, Draft.InvalidDraft> => {
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
    return Effect.fail(
      new Draft.InvalidDraft({ reason: "a club is listed among the finalists twice" }),
    );
  }
  if (!Arr.every(finalists, (club) => Arr.contains(season.ladder, club))) {
    return Effect.fail(new Draft.InvalidDraft({ reason: "every finalist must be on the ladder" }));
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

const dvi2015: ReadonlyArray<number> = [
  3000, 2517, 2234, 2034, 1878, 1751, 1644, 1551, 1469, 1395, 1329, 1268, 1212, 1161, 1112, 1067,
  1025, 985, 948, 912, 878, 845, 815, 785, 756, 729, 703, 677, 653, 629, 606, 584, 563, 542, 522,
  502, 483, 465, 446, 429, 412, 395, 378, 362, 347, 331, 316, 302, 287, 273, 259, 246, 233, 220,
  207, 194, 182, 170, 158, 146, 135, 123, 112, 101, 90, 80, 69, 59, 49, 39, 29, 19, 9,
];

/**
 * The points value of pick `number` (from 1) in the draft value index as
 * introduced in 2015: 3,000 for pick 1, falling to 9 for pick 73, then 0.
 */
export const draftValueIndex = (number: number): number =>
  Option.getOrElse(Arr.get(dvi2015, number - 1), () => 0);

/** Where an AFL Commission priority pick falls. */
export type Placement = "StartOfFirstRound" | "EndOfFirstRound" | "EndOfSecondRound";

/** A priority pick granted to a club. */
export interface PriorityPick {
  readonly club: Choice.ActorId;
  readonly placement: Placement;
}

/** A traded pick: the `round` pick `originalClub` was allotted now belongs to `club`. */
export interface Trade {
  readonly round: number;
  readonly originalClub: Choice.ActorId;
  readonly club: Choice.ActorId;
}

/** A father-son, academy or Next Generation Academy nomination. */
export interface Nomination {
  readonly player: Choice.AlternativeId;
  readonly club: Choice.ActorId;
  readonly kind: "FatherSon" | "Academy" | "NextGenerationAcademy";
}

/** An AFL national draft. */
export interface AflDraft {
  readonly season: Season;
  readonly rounds: number;
  readonly players: ReadonlyArray<Choice.AlternativeId>;
  readonly priorityPicks?: ReadonlyArray<PriorityPick>;
  readonly trades?: ReadonlyArray<Trade>;
  readonly nominations?: ReadonlyArray<Nomination>;
  /** The points table. Defaults to {@link draftValueIndex}. */
  readonly points?: (number: number) => number;
  /** The share of a bid's value a matching club is excused. Defaults to 20 per cent. */
  readonly discount?: number;
}

/** After the last pick of `round`. */
const endOfRound = (picks: ReadonlyArray<Draft.Pick>, round: number): number =>
  Option.match(
    Arr.findLastIndex(picks, (pick) => pick.round === round),
    {
      onNone: () => picks.length,
      onSome: (index) => index + 1,
    },
  );

const placeAt: Record<Placement, (picks: ReadonlyArray<Draft.Pick>) => number> = {
  StartOfFirstRound: () => 0,
  EndOfFirstRound: (picks) => endOfRound(picks, 1),
  EndOfSecondRound: (picks) => endOfRound(picks, 2),
};

const roundOf: Record<Placement, number> = {
  StartOfFirstRound: 1,
  EndOfFirstRound: 1,
  EndOfSecondRound: 2,
};

const validate = (rounds: number, discount: number): Effect.Effect<void, Draft.InvalidDraft> =>
  !Number.isInteger(rounds) || rounds < 1
    ? Effect.fail(new Draft.InvalidDraft({ reason: "a draft has at least one round" }))
    : discount < 0 || discount > 1
      ? Effect.fail(new Draft.InvalidDraft({ reason: "the discount is a share from 0 to 1" }))
      : Effect.void;

/** The AFL draft as a generic {@link Draft.Draft}. */
export const toDraft = (afl: AflDraft): Effect.Effect<Draft.Draft, Draft.InvalidDraft> =>
  Effect.gen(function* () {
    const discount = afl.discount ?? 0.2;
    yield* validate(afl.rounds, discount);
    const order = yield* draftOrder(afl.season);
    const prioritised = Arr.reduce(
      afl.priorityPicks ?? [],
      Draft.linear(order, afl.rounds),
      (picks, priority) =>
        Draft.insert(picks, placeAt[priority.placement](picks), [
          {
            round: roundOf[priority.placement],
            originalTeam: priority.club,
            team: priority.club,
            kind: "Priority",
          },
        ]),
    );
    const picks = yield* Effect.reduce(
      afl.trades ?? [],
      () => prioritised,
      (current, trade) =>
        Draft.trade(
          current,
          (pick) =>
            pick.kind === "Regular" &&
            pick.round === trade.round &&
            pick.originalTeam === trade.originalClub,
          trade.club,
        ),
    );
    return {
      picks,
      players: afl.players,
      claims: Arr.map(afl.nominations ?? [], (n) => ({
        player: n.player,
        team: n.club,
        kind: n.kind,
      })),
      matching: Draft.matchWithPoints({ points: afl.points ?? draftValueIndex, discount }),
    };
  });

/** Runs an AFL draft, asking `agent` each club's choices. */
export const run = <E, R>(
  afl: AflDraft,
  agent: Choice.Agent<Draft.Prompt, Draft.Response, E, R>,
): Effect.Effect<Draft.Result, Draft.InvalidDraft | Draft.InvalidResponse | E, R> =>
  Effect.flatMap(toDraft(afl), (draft) => Draft.run(draft, agent));
