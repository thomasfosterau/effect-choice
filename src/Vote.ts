/**
 * Elections: voters (anonymous actors) rank candidates (alternatives), and a
 * counting method elects some of them.
 *
 * - {@link stv} counts a single transferable vote under configurable
 *   {@link Rules}: the quota, how surpluses are transferred, how excluded
 *   candidates' papers move, and the order surpluses are dealt with. With one
 *   seat it is instant-runoff (preferential) voting. The rules cover the
 *   Australian families of STV: Hare-Clark's last bundle, the inclusive
 *   Gregory method and the weighted inclusive Gregory method.
 * - {@link plurality} ({@link firstPastThePost} for one seat), {@link approval}
 *   and {@link borda} are scoring counts: the candidates with the most points
 *   are elected.
 * - {@link instantRunoff} is the single transferable vote for one seat.
 *
 * Votes are whole numbers: a parcel of papers moving at a fractional
 * transfer value is worth its papers times that value, rounded down, and what
 * rounding and exhausted papers lose is set aside, so the totals and the
 * set-aside always add up to the formal vote. Transfer values are exact
 * rationals, so a count is reproducible to the vote.
 *
 * Ties go to the candidate who was lower (or higher) at the most recent count
 * at which the tied candidates' totals differed, and otherwise to the active
 * {@link TieBreak.TieBreak} rule.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Rational from "effect/Rational";
import * as R from "effect/Record";
import * as Schema from "effect/Schema";
import * as Choice from "./Choice.ts";
import * as TieBreak from "./TieBreak.ts";

/**
 * A candidate standing for election.
 *
 * @since 0.1.0
 */
export interface Candidate {
  /** The candidate's identifier, which ballots refer to. */
  readonly id: Choice.AlternativeId;
  /** The candidate's name, for display. */
  readonly name: string;
}

/**
 * One voter's ballot: candidate identifiers in order of preference, first
 * preference first.
 *
 * Numbering is read as electoral law reads it: preferences count up to the
 * first that names an unknown candidate or repeats an earlier one, and a
 * ballot is informal when fewer than the election's `minimumPreferences`
 * survive.
 *
 * @since 0.1.0
 */
export type Ballot = ReadonlyArray<Choice.AlternativeId>;

/**
 * The election being counted.
 *
 * @since 0.1.0
 */
export interface Election {
  /** The number of vacancies to fill. */
  readonly seats: number;
  /** The candidates, in ballot-paper order; this order also settles {@link TieBreak.first} ties. */
  readonly candidates: ReadonlyArray<Candidate>;
}

/**
 * Which papers an elected candidate's surplus moves, and at what value.
 *
 * - `LastBundle`: only the parcel that took the candidate to quota, at the
 *   surplus over that parcel's papers with a next continuing preference,
 *   never more than the value they arrived at (Hare-Clark).
 * - `Inclusive`: all the candidate's papers, at the surplus over the number
 *   of papers, whatever value they arrived at (the unweighted inclusive
 *   Gregory method).
 * - `WeightedInclusive`: all the candidate's papers, each parcel at its own
 *   value scaled by the surplus over the candidate's total (the weighted
 *   inclusive Gregory method).
 *
 * @since 0.1.0
 */
export type SurplusMethod = "LastBundle" | "Inclusive" | "WeightedInclusive";

/**
 * How an excluded candidate's papers move: `ByTransferValue`, one count per
 * transfer value, highest first; or `AllAtOnce`, in a single count.
 *
 * @since 0.1.0
 */
export type ExclusionMethod = "ByTransferValue" | "AllAtOnce";

/**
 * Which pending surplus is transferred first: the `Largest`, or the
 * earliest-elected candidate's (`ElectionOrder`).
 *
 * @since 0.1.0
 */
export type SurplusOrder = "Largest" | "ElectionOrder";

/**
 * The counting rules of a single transferable vote. Every rule is optional;
 * the defaults are the weighted inclusive Gregory method with the Droop quota.
 *
 * @since 0.1.0
 */
export interface Rules {
  /** The quota for a number of formal ballots and seats. Defaults to {@link droopQuota}. */
  readonly quota?: (formal: number, seats: number) => number;
  /** How surpluses are transferred. Defaults to `"WeightedInclusive"`. */
  readonly surplus?: SurplusMethod;
  /** How excluded candidates' papers move. Defaults to `"AllAtOnce"`. */
  readonly exclusion?: ExclusionMethod;
  /** Which pending surplus is transferred first. Defaults to `"Largest"`. */
  readonly surplusOrder?: SurplusOrder;
  /** The fewest valid preferences a formal ballot shows. Defaults to `1`. */
  readonly minimumPreferences?: number;
}

/**
 * What a count did.
 *
 * @since 0.1.0
 */
export type Action =
  | {
      /** The first count: each formal ballot to its first preference. */
      readonly _tag: "FirstPreferences";
    }
  | {
      /** A scoring count's only count: each candidate's points. */
      readonly _tag: "Scores";
    }
  | {
      /** The transfer of an elected candidate's surplus. */
      readonly _tag: "Surplus";
      /** The elected candidate. */
      readonly candidate: Choice.AlternativeId;
      /** The value each transferred paper carried, when they all carried one value. */
      readonly transferValue: Option.Option<Rational.Rational>;
    }
  | {
      /** The transfer of an excluded candidate's papers. */
      readonly _tag: "Exclusion";
      /** The excluded candidate. */
      readonly candidate: Choice.AlternativeId;
      /** The value each transferred paper carried, when they all carried one value. */
      readonly transferValue: Option.Option<Rational.Rational>;
    };

/**
 * One count of the scrutiny: what was done, and the totals it left.
 *
 * @since 0.1.0
 */
export interface Count {
  /** The count's number, from 1. */
  readonly number: number;
  /** What the count did. */
  readonly action: Action;
  /** The votes each candidate gained (or, for the candidate whose papers moved, lost) at this count. */
  readonly changes: Readonly<Record<Choice.AlternativeId, number>>;
  /** Each candidate's progressive total after the count. */
  readonly totals: Readonly<Record<Choice.AlternativeId, number>>;
  /** The progressive total of votes exhausted or lost by fraction. */
  readonly setAside: number;
  /** The candidates elected at this count, in order of election. */
  readonly elected: ReadonlyArray<Choice.AlternativeId>;
}

/**
 * The declared result of a count.
 *
 * @since 0.1.0
 */
export interface Result {
  /** The number of formal ballots. */
  readonly formal: number;
  /** The number of informal ballots. */
  readonly informal: number;
  /** The quota. */
  readonly quota: number;
  /** The elected candidates, in order of election. */
  readonly elected: ReadonlyArray<Choice.AlternativeId>;
  /** The excluded candidates, in order of exclusion. */
  readonly excluded: ReadonlyArray<Choice.AlternativeId>;
  /** Every count, in order. */
  readonly counts: ReadonlyArray<Count>;
}

/**
 * An election that cannot be counted: no vacancies, fewer candidates than
 * vacancies, or a repeated candidate identifier.
 *
 * @since 0.1.0
 */
export class InvalidElection extends Schema.TaggedError<
  InvalidElection,
  { readonly brand: unique symbol }
>()("InvalidElection", {
  /** Why the election cannot be counted. */
  reason: Schema.String,
}) {}

/**
 * The Droop quota for `formal` ballots and `seats` vacancies:
 * `floor(formal / (seats + 1)) + 1`.
 *
 * @since 0.1.0
 */
export const droopQuota = (formal: number, seats: number): number =>
  Math.floor(formal / (seats + 1)) + 1;

/**
 * The Hare quota for `formal` ballots and `seats` vacancies:
 * `ceil(formal / seats)`.
 *
 * @since 0.1.0
 */
export const hareQuota = (formal: number, seats: number): number => Math.ceil(formal / seats);

/**
 * The preferences of `ballot` that count: those before the first unknown or
 * repeated candidate.
 *
 * @since 0.1.0
 */
export const validPreferences = (
  ballot: Ballot,
  candidates: ReadonlyArray<Choice.AlternativeId>,
): Ballot =>
  Arr.takeWhile(
    ballot,
    (id, index) => Arr.contains(candidates, id) && !Arr.contains(Arr.take(ballot, index), id),
  );

// --- The count ---------------------------------------------------------------

/** A ballot paper sitting with the candidate at preference `at`. */
interface Paper {
  readonly ballot: Ballot;
  readonly at: number;
}

/** Papers received together, at one count and one transfer value. */
interface Parcel {
  readonly papers: ReadonlyArray<Paper>;
  readonly value: Rational.Rational;
  readonly votes: number;
}

type Status = "continuing" | "elected" | "excluded";

const continuingStatus: Status = "continuing";

interface State {
  readonly rules: Required<Rules>;
  readonly seats: number;
  readonly quota: number;
  readonly order: ReadonlyArray<Choice.AlternativeId>;
  readonly status: Readonly<Record<Choice.AlternativeId, Status>>;
  readonly parcels: Readonly<Record<Choice.AlternativeId, ReadonlyArray<Parcel>>>;
  readonly totals: Readonly<Record<Choice.AlternativeId, number>>;
  readonly setAside: number;
  readonly elected: ReadonlyArray<Choice.AlternativeId>;
  readonly excluded: ReadonlyArray<Choice.AlternativeId>;
  readonly surpluses: ReadonlyArray<Choice.AlternativeId>;
  readonly counts: ReadonlyArray<Count>;
}

const one = Rational.fromBigInt(1n);

const votesAt = (papers: number, value: Rational.Rational): number =>
  Number((BigInt(papers) * value.numerator) / value.denominator);

const statusOf = (state: State, id: Choice.AlternativeId): Status => state.status[id] ?? "excluded";

const continuing = (state: State): ReadonlyArray<Choice.AlternativeId> =>
  Arr.filter(state.order, (id) => statusOf(state, id) === "continuing");

const totalOf = (
  totals: Readonly<Record<Choice.AlternativeId, number>>,
  id: Choice.AlternativeId,
) => totals[id] ?? 0;

/** Papers moved on to their next continuing preferences. */
interface Routed {
  /** The papers each continuing candidate receives, in ballot-paper order. */
  readonly to: ReadonlyArray<readonly [Choice.AlternativeId, ReadonlyArray<Paper>]>;
  /** How many papers showed no further continuing preference. */
  readonly exhausted: number;
}

/** Each paper moved on to its next continuing preference, grouped by candidate in ballot-paper order. */
const route = (state: State, papers: ReadonlyArray<Paper>): Routed => {
  const moved = Arr.getSomes(
    Arr.map(papers, (paper) =>
      Option.map(
        Arr.findFirstIndex(
          paper.ballot,
          (id, index) => index > paper.at && statusOf(state, id) === "continuing",
        ),
        (at): Paper => ({ ballot: paper.ballot, at }),
      ),
    ),
  );
  const groups = Arr.groupBy(moved, (paper) => paper.ballot[paper.at] ?? "");
  return {
    to: Arr.getSomes(
      Arr.map(state.order, (id) =>
        Option.map(Option.fromUndefinedOr(groups[id]), (group) => [id, group] as const),
      ),
    ),
    exhausted: papers.length - moved.length,
  };
};

/**
 * Narrows `tied` to the candidates `pick` prefers at the most recent count at
 * which their totals differ, then asks the tie rule.
 */
const breakTie = (
  state: State,
  tied: Arr.NonEmptyReadonlyArray<Choice.AlternativeId>,
  pick: (totals: ReadonlyArray<number>) => number,
  reason: string,
): Effect.Effect<Choice.AlternativeId, TieBreak.TieUnresolved> => {
  const narrowed = Arr.reduceRight(state.counts, tied, (remaining, count) => {
    const best = pick(Arr.map(remaining, (id) => totalOf(count.totals, id)));
    const kept = Arr.filter(remaining, (id) => totalOf(count.totals, id) === best);
    return Arr.isReadonlyArrayNonEmpty(kept) ? kept : remaining;
  });
  return TieBreak.choose(narrowed, reason);
};

const extreme = (
  state: State,
  candidates: Arr.NonEmptyReadonlyArray<Choice.AlternativeId>,
  value: (id: Choice.AlternativeId) => number,
  direction: "lowest" | "highest",
  reason: string,
): Effect.Effect<Choice.AlternativeId, TieBreak.TieUnresolved> => {
  const pick = (values: ReadonlyArray<number>) =>
    direction === "lowest" ? Math.min(...values) : Math.max(...values);
  const best = pick(Arr.map(candidates, value));
  const tied = Arr.filter(candidates, (id) => value(id) === best);
  return Arr.isReadonlyArrayNonEmpty(tied)
    ? breakTie(state, tied, pick, reason)
    : Effect.succeed(Arr.headNonEmpty(candidates));
};

/** Elects every continuing candidate at or above quota, highest total first. */
const electAtQuota = (state: State): State => {
  const reached = Arr.sort(
    Arr.filter(continuing(state), (id) => totalOf(state.totals, id) >= state.quota),
    byTotalDescending(state),
  );
  const room = Arr.take(reached, state.seats - state.elected.length);
  return Arr.isReadonlyArrayEmpty(room)
    ? state
    : {
        ...markElected(state, room),
        surpluses: Arr.appendAll(
          state.surpluses,
          Arr.filter(room, (id) => totalOf(state.totals, id) > state.quota),
        ),
      };
};

/** Papers moving together at one value. */
interface Group {
  readonly papers: ReadonlyArray<Paper>;
  readonly value: Rational.Rational;
}

/** The value every group carries, if they all carry the same one. */
const commonValue = (groups: ReadonlyArray<Group>): Option.Option<Rational.Rational> =>
  Arr.match(
    Arr.dedupeWith(
      Arr.map(groups, (group) => group.value),
      Rational.equals,
    ),
    {
      onEmpty: () => Option.some(one),
      onNonEmpty: (values) => (values.length === 1 ? Option.some(values[0]) : Option.none()),
    },
  );

/** Records a count that moved `groups` of papers from `from`, taking `votes` off it. */
const transfer = (
  state: State,
  action: Action,
  from: Option.Option<Choice.AlternativeId>,
  groups: ReadonlyArray<Group>,
  votes: number,
): State => {
  const moves = Arr.flatMap(groups, (group) =>
    Arr.map(route(state, group.papers).to, ([id, papers]) => ({
      id,
      parcel: { papers, value: group.value, votes: votesAt(papers.length, group.value) },
    })),
  );
  const gains = R.map(
    Arr.groupBy(moves, (move) => move.id),
    (all) => Arr.reduce(all, 0, (sum, move) => sum + move.parcel.votes),
  );
  const moved = Arr.reduce(moves, 0, (sum, move) => sum + move.parcel.votes);
  const changes: Record<Choice.AlternativeId, number> = Option.match(from, {
    onNone: () => gains,
    onSome: (id) => ({ ...gains, [id]: -votes }),
  });
  const totals = R.fromEntries(
    Arr.map(state.order, (id) => [id, totalOf(state.totals, id) + (changes[id] ?? 0)] as const),
  );
  const parcels = Arr.reduce(moves, state.parcels, (all, move) => ({
    ...all,
    [move.id]: Arr.append(all[move.id] ?? [], move.parcel),
  }));
  const setAside = state.setAside + votes - moved;
  return electAtQuota({
    ...state,
    totals,
    parcels,
    setAside,
    counts: Arr.append(state.counts, {
      number: state.counts.length + 1,
      action,
      changes,
      totals,
      setAside,
      elected: [],
    }),
  });
};

const papersIn = (all: ReadonlyArray<Parcel>) => Arr.flatMap(all, (parcel) => parcel.papers);

/** `numerator / denominator`, or 0 when there is nothing to divide among. */
const ratio = (numerator: number, denominator: number) =>
  denominator === 0
    ? Rational.fromBigInt(0n)
    : Rational.makeUnsafe(BigInt(numerator), BigInt(denominator));

/** The papers an elected candidate's surplus moves, by the counting rules. */
const surplusGroups = (
  state: State,
  candidate: Choice.AlternativeId,
  surplus: number,
): ReadonlyArray<Group> => {
  const parcels = state.parcels[candidate] ?? [];
  const continuingPapers = (papers: ReadonlyArray<Paper>) =>
    Arr.reduce(route(state, papers).to, 0, (sum, [, group]) => sum + group.length);
  const methods: Record<SurplusMethod, () => ReadonlyArray<Group>> = {
    LastBundle: () =>
      Arr.fromOption(
        Option.map(Arr.last(parcels), (last) => ({
          papers: last.papers,
          value: Rational.min(ratio(surplus, continuingPapers(last.papers)), last.value),
        })),
      ),
    Inclusive: () => {
      const papers = papersIn(parcels);
      return [{ papers, value: ratio(surplus, papers.length) }];
    },
    WeightedInclusive: () => {
      const scale = ratio(surplus, totalOf(state.totals, candidate));
      return Arr.map(parcels, (parcel) => ({
        papers: parcel.papers,
        value: Rational.multiply(parcel.value, scale),
      }));
    },
  };
  return methods[state.rules.surplus]();
};

const distributeSurplus = (state: State): Effect.Effect<State, TieBreak.TieUnresolved> =>
  Effect.gen(function* () {
    const pending = Arr.filter(state.surpluses, (id) => statusOf(state, id) === "elected");
    if (!Arr.isReadonlyArrayNonEmpty(pending)) {
      return { ...state, surpluses: [] };
    }
    const candidate =
      state.rules.surplusOrder === "ElectionOrder"
        ? Arr.headNonEmpty(pending)
        : yield* extreme(
            state,
            pending,
            (id) => totalOf(state.totals, id),
            "highest",
            `largest surplus at count ${state.counts.length}`,
          );
    const rest = { ...state, surpluses: Arr.filter(pending, (id) => id !== candidate) };
    const surplus = totalOf(state.totals, candidate) - state.quota;
    const groups = surplusGroups(state, candidate, surplus);
    return transfer(
      rest,
      { _tag: "Surplus", candidate, transferValue: commonValue(groups) },
      Option.some(candidate),
      groups,
      surplus,
    );
  });

const exclude = (state: State): Effect.Effect<State, TieBreak.TieUnresolved> =>
  Effect.gen(function* () {
    const candidates = continuing(state);
    if (!Arr.isReadonlyArrayNonEmpty(candidates)) {
      return state;
    }
    const candidate = yield* extreme(
      state,
      candidates,
      (id) => totalOf(state.totals, id),
      "lowest",
      `exclusion at count ${state.counts.length + 1}`,
    );
    const excluded: State = {
      ...state,
      status: { ...state.status, [candidate]: "excluded" },
      excluded: Arr.append(state.excluded, candidate),
    };
    const parcels = state.parcels[candidate] ?? [];
    const values = Arr.sort(
      Arr.dedupeWith(
        Arr.map(parcels, (parcel) => parcel.value),
        Rational.equals,
      ),
      Order.flip(Rational.Order),
    );
    const byValue: ReadonlyArray<ReadonlyArray<Group>> =
      state.rules.exclusion === "AllAtOnce"
        ? [Arr.map(parcels, (parcel) => ({ papers: parcel.papers, value: parcel.value }))]
        : Arr.map(values, (value) => [
            {
              value,
              papers: Arr.flatMap(
                Arr.filter(parcels, (parcel) => Rational.equals(parcel.value, value)),
                (parcel: Parcel) => parcel.papers,
              ),
            },
          ]);
    const counts: ReadonlyArray<ReadonlyArray<Group>> = Arr.isReadonlyArrayEmpty(byValue)
      ? [[]]
      : byValue;
    return Arr.reduce(counts, excluded, (current, groups) =>
      current.elected.length >= current.seats
        ? current
        : transfer(
            current,
            { _tag: "Exclusion", candidate, transferValue: commonValue(groups) },
            Option.some(candidate),
            groups,
            Arr.reduce(
              Arr.filter(parcels, (parcel) =>
                Arr.some(groups, (group) => Rational.equals(group.value, parcel.value)),
              ),
              0,
              (sum, parcel) => sum + parcel.votes,
            ),
          ),
    );
  });

/** Appends `ids` to the candidates elected at the latest count. */
const markElected = (state: State, ids: ReadonlyArray<Choice.AlternativeId>): State => ({
  ...state,
  status: Arr.reduce(ids, state.status, (status, id) => ({ ...status, [id]: "elected" })),
  elected: Arr.appendAll(state.elected, ids),
  counts: Arr.match(state.counts, {
    onEmpty: () => state.counts,
    onNonEmpty: (counts) =>
      Arr.append(Arr.initNonEmpty(counts), {
        ...Arr.lastNonEmpty(counts),
        elected: Arr.appendAll(Arr.lastNonEmpty(counts).elected, ids),
      }),
  }),
});

const byTotalDescending = (state: State): Order.Order<Choice.AlternativeId> =>
  Order.mapInput(Order.flip(Order.Number), (id: Choice.AlternativeId) => totalOf(state.totals, id));

/** Elects every continuing candidate, highest total first, at the latest count. */
const electRemaining = (state: State): State =>
  markElected(state, Arr.sort(continuing(state), byTotalDescending(state)));

const step = (state: State): Effect.Effect<State, TieBreak.TieUnresolved> =>
  Effect.suspend(() => {
    const vacancies = state.seats - state.elected.length;
    if (vacancies <= 0) {
      return Effect.succeed(state);
    }
    if (continuing(state).length <= vacancies) {
      return Effect.succeed(electRemaining(state));
    }
    const next = Arr.some(state.surpluses, (id) => statusOf(state, id) === "elected")
      ? distributeSurplus(state)
      : exclude(state);
    return Effect.flatMap(next, step);
  });

const defaults: Required<Rules> = {
  quota: droopQuota,
  surplus: "WeightedInclusive",
  exclusion: "AllAtOnce",
  surplusOrder: "Largest",
  minimumPreferences: 1,
};

interface Prepared {
  readonly ids: ReadonlyArray<Choice.AlternativeId>;
  readonly formal: ReadonlyArray<Ballot>;
  readonly informal: number;
}

/** Validates `election` and sorts `ballots` into formal and informal. */
const prepare = (
  election: Election,
  ballots: ReadonlyArray<Ballot>,
  minimumPreferences: number,
): Effect.Effect<Prepared, InvalidElection> => {
  const ids = Arr.map(election.candidates, (candidate) => candidate.id);
  if (!Number.isInteger(election.seats) || election.seats < 1) {
    return Effect.fail(new InvalidElection({ reason: "seats must be a positive integer" }));
  }
  if (Arr.dedupe(ids).length !== ids.length) {
    return Effect.fail(new InvalidElection({ reason: "candidate identifiers must be unique" }));
  }
  if (ids.length < election.seats) {
    return Effect.fail(new InvalidElection({ reason: "there are fewer candidates than seats" }));
  }
  const minimum = Math.max(1, minimumPreferences);
  const valid = Arr.map(ballots, (ballot) => validPreferences(ballot, ids));
  const formal = Arr.filter(valid, (ballot) => ballot.length >= minimum);
  return Effect.succeed({ ids, formal, informal: valid.length - formal.length });
};

const initialState = (
  election: Election,
  rules: Required<Rules>,
  prepared: Prepared,
  quota: number,
): State => ({
  rules,
  seats: election.seats,
  quota,
  order: prepared.ids,
  status: R.fromEntries(Arr.map(prepared.ids, (id) => [id, continuingStatus] as const)),
  parcels: {},
  totals: R.fromEntries(Arr.map(prepared.ids, (id) => [id, 0] as const)),
  setAside: 0,
  elected: [],
  excluded: [],
  surpluses: [],
  counts: [],
});

const firstPreferences = (state: State, formal: ReadonlyArray<Ballot>): State =>
  transfer(
    state,
    { _tag: "FirstPreferences" },
    Option.none(),
    [{ papers: Arr.map(formal, (ballot): Paper => ({ ballot, at: -1 })), value: one }],
    formal.length,
  );

const declare = (prepared: Prepared, final: State): Result => ({
  formal: prepared.formal.length,
  informal: prepared.informal,
  quota: final.quota,
  elected: final.elected,
  excluded: final.excluded,
  counts: final.counts,
});

/**
 * Counts `ballots` for `election` by single transferable vote under `rules`.
 * With one seat this is instant-runoff voting.
 *
 * Fails with {@link InvalidElection} when the election cannot be counted, and
 * with {@link TieBreak.TieUnresolved} when a tie reaches a tie rule that
 * refuses it.
 *
 * @example
 * ```ts
 * import { Choice, Vote } from "@thomasfosterau/effect-choice";
 *
 * const [a, b, c] = ["a", "b", "c"].map(Choice.AlternativeId);
 * const result = Vote.stv(
 *   { seats: 2, candidates: [{ id: a, name: "A" }, { id: b, name: "B" }, { id: c, name: "C" }] },
 *   [[a, b], [a, c], [b], [c, b]],
 *   { surplus: "LastBundle", exclusion: "ByTransferValue" },
 * );
 * ```
 *
 * @since 0.1.0
 */
export const stv = (
  election: Election,
  ballots: ReadonlyArray<Ballot>,
  rules: Rules = {},
): Effect.Effect<Result, InvalidElection | TieBreak.TieUnresolved> =>
  Effect.gen(function* () {
    const resolved: Required<Rules> = { ...defaults, ...rules };
    const prepared = yield* prepare(election, ballots, resolved.minimumPreferences);
    const quota = resolved.quota(prepared.formal.length, election.seats);
    const first = firstPreferences(
      initialState(election, resolved, prepared, quota),
      prepared.formal,
    );
    return declare(prepared, yield* step(first));
  }).pipe(Effect.withSpan("Vote.stv"));

/**
 * A scoring count: each formal ballot gives each candidate some points, and
 * the `seats` candidates with the most points are elected, in order. The
 * result has no quota (its `quota` is 0), and its one count shows the scores.
 */
const scored =
  (
    name: string,
    points: (
      ballot: Ballot,
      candidates: number,
    ) => ReadonlyArray<readonly [Choice.AlternativeId, number]>,
  ): Method =>
  (election, ballots) =>
    Effect.gen(function* () {
      const prepared = yield* prepare(election, ballots, 1);
      const awarded = Arr.flatMap(prepared.formal, (ballot) => points(ballot, prepared.ids.length));
      const totals = R.fromEntries(
        Arr.map(
          prepared.ids,
          (id) =>
            [
              id,
              Arr.reduce(awarded, 0, (sum, [to, value]) => (to === id ? sum + value : sum)),
            ] as const,
        ),
      );
      const counted: State = {
        ...initialState(election, defaults, prepared, 0),
        totals,
        counts: [
          {
            number: 1,
            action: { _tag: "Scores" },
            changes: totals,
            totals,
            setAside: 0,
            elected: [],
          },
        ],
      };
      const elect = (state: State): Effect.Effect<State, TieBreak.TieUnresolved> => {
        const candidates = continuing(state);
        return state.elected.length >= state.seats || !Arr.isReadonlyArrayNonEmpty(candidates)
          ? Effect.succeed(state)
          : extreme(
              state,
              candidates,
              (id) => totalOf(state.totals, id),
              "highest",
              `${name}: most points for a seat`,
            ).pipe(Effect.flatMap((id) => elect(markElected(state, [id]))));
      };
      const final = yield* elect(counted);
      return declare(prepared, { ...final, excluded: continuing(final) });
    }).pipe(Effect.withSpan(`Vote.${name}`));

/**
 * Plurality: one point for each ballot's first preference, and the `seats`
 * candidates with the most are elected. With one seat this is first past the
 * post; with more, the single non-transferable vote.
 *
 * @since 0.1.0
 */
export const plurality: Method = scored("plurality", (ballot) =>
  Arr.fromOption(Option.map(Arr.head(ballot), (first) => [first, 1] as const)),
);

/**
 * First past the post: {@link plurality} for a single seat. Fails with
 * {@link InvalidElection} for more seats.
 *
 * @since 0.1.0
 */
export const firstPastThePost: Method = (election, ballots) =>
  election.seats === 1
    ? plurality(election, ballots)
    : Effect.fail(new InvalidElection({ reason: "first past the post fills a single seat" }));

/**
 * Approval voting: each ballot lists the candidates it approves of, in any
 * order, and each gets one point. The `seats` most approved are elected.
 *
 * @since 0.1.0
 */
export const approval: Method = scored("approval", (ballot) =>
  Arr.map(ballot, (id) => [id, 1] as const),
);

/**
 * The Borda count: with `n` candidates, a ballot's first preference gets
 * `n - 1` points, its second `n - 2`, and so on; unranked candidates get
 * none. The `seats` candidates with the most points are elected.
 *
 * @since 0.1.0
 */
export const borda: Method = scored("borda", (ballot, candidates) =>
  Arr.map(ballot, (id, index) => [id, candidates - 1 - index] as const),
);

/**
 * Instant-runoff (preferential) voting: the single transferable vote for one
 * seat, with the default {@link Rules} unless others are given. Fails with
 * {@link InvalidElection} for more seats.
 *
 * @since 0.1.0
 */
export const instantRunoff =
  (rules: Rules = {}): Method =>
  (election, ballots) =>
    election.seats === 1
      ? stv(election, ballots, rules)
      : Effect.fail(new InvalidElection({ reason: "instant runoff fills a single seat" }));

/**
 * A counting method: {@link stv} with some rules, {@link plurality},
 * {@link approval}, {@link borda}, or your own.
 *
 * @since 0.1.0
 */
export type Method = (
  election: Election,
  ballots: ReadonlyArray<Ballot>,
) => Effect.Effect<Result, InvalidElection | TieBreak.TieUnresolved>;

/**
 * An election as a sealed {@link Choice.Mechanism}: voters' ballots in, the
 * declared result out, counted by `method` (by default {@link stv} with the
 * default rules).
 *
 * @since 0.1.0
 */
export const mechanism = (
  election: Election,
  method: Method = (e, b) => stv(e, b),
): Choice.Mechanism<Ballot, Result, InvalidElection | TieBreak.TieUnresolved> =>
  Choice.mechanism("Vote", (ballots) => method(election, ballots));
