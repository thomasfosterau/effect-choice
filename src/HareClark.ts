/**
 * Hare-Clark: the proportional single transferable vote used for the
 * Tasmanian House of Assembly and the ACT Legislative Assembly.
 *
 * Voters (anonymous actors) number candidates in order of preference. The
 * count follows the scrutiny rules the two jurisdictions share:
 *
 * - **Quota**: the Droop quota, `floor(formal / (seats + 1)) + 1`.
 * - **Surpluses** are transferred by the _last bundle_ (Gregory) method: only
 *   the parcel of papers that took the candidate to quota is re-examined, at a
 *   transfer value of the surplus over the number of those papers that show a
 *   next continuing preference, never more than the value they arrived at.
 *   Each continuing candidate gains the number of their papers times that
 *   value, rounded down; the fractions are set aside (lost by fraction), as
 *   are papers that exhaust. The largest surplus is transferred first.
 * - **Exclusions** remove the lowest candidate and transfer their papers at the
 *   values they were received at, one count per transfer value, highest first.
 * - A candidate who reaches quota is elected at once and receives no further
 *   papers. Once the continuing candidates are no more than the vacancies left,
 *   they are all elected.
 * - **Ties** (for the lowest candidate, or the largest surplus) go to the
 *   candidate who was lower (or higher) at the most recent count at which the
 *   tied candidates' totals differed, and otherwise to the active
 *   {@link TieBreak.TieBreak} rule.
 *
 * Robson rotation (the ballot-paper ordering) does not affect the count, so it
 * is not modelled. Values are kept as exact rationals, so the count is
 * reproducible to the vote.
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
  /**
   * The fewest valid preferences a formal ballot shows. The ACT accepts a
   * single first preference (the default, `1`); Tasmania requires at least as
   * many preferences as there are vacancies.
   */
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
      /** The transfer of an elected candidate's surplus. */
      readonly _tag: "Surplus";
      /** The elected candidate. */
      readonly candidate: Choice.AlternativeId;
      /** The value each transferred paper carried. */
      readonly transferValue: Rational.Rational;
    }
  | {
      /** The transfer of one value's worth of an excluded candidate's papers. */
      readonly _tag: "Exclusion";
      /** The excluded candidate. */
      readonly candidate: Choice.AlternativeId;
      /** The value each transferred paper carried. */
      readonly transferValue: Rational.Rational;
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
 * The Droop quota for `formal` ballots and `seats` vacancies.
 *
 * @since 0.1.0
 */
export const quota = (formal: number, seats: number): number =>
  Math.floor(formal / (seats + 1)) + 1;

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

/** Records a count that moved `papers` from `from` at `value`, taking `votes` off it. */
const transfer = (
  state: State,
  action: Action,
  from: Option.Option<Choice.AlternativeId>,
  papers: ReadonlyArray<Paper>,
  value: Rational.Rational,
  votes: number,
): State => {
  const { to } = route(state, papers);
  const gains = Arr.map(to, ([id, group]) => [id, votesAt(group.length, value)] as const);
  const moved = Arr.reduce(gains, 0, (sum, [, gain]) => sum + gain);
  const changes: Record<Choice.AlternativeId, number> = Option.match(from, {
    onNone: () => R.fromEntries(gains),
    onSome: (id) => ({ ...R.fromEntries(gains), [id]: -votes }),
  });
  const totals = R.map(
    R.fromEntries(Arr.map(state.order, (id) => [id, totalOf(state.totals, id)] as const)),
    (total, id) => total + (changes[id] ?? 0),
  );
  const parcels = Arr.reduce(Arr.zip(to, gains), state.parcels, (all, [[id, group], [, gain]]) => ({
    ...all,
    [id]: Arr.append(all[id] ?? [], { papers: group, value, votes: gain }),
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

const distributeSurplus = (state: State): Effect.Effect<State, TieBreak.TieUnresolved> =>
  Effect.gen(function* () {
    const pending = Arr.filter(state.surpluses, (id) => statusOf(state, id) === "elected");
    if (!Arr.isReadonlyArrayNonEmpty(pending)) {
      return { ...state, surpluses: [] };
    }
    const candidate = yield* extreme(
      state,
      pending,
      (id) => totalOf(state.totals, id),
      "highest",
      `largest surplus at count ${state.counts.length}`,
    );
    const rest = { ...state, surpluses: Arr.filter(pending, (id) => id !== candidate) };
    const surplus = totalOf(state.totals, candidate) - state.quota;
    const last = Arr.last(state.parcels[candidate] ?? []);
    const papers = Option.match(last, { onNone: () => [], onSome: (parcel) => parcel.papers });
    const continuingPapers = Arr.reduce(
      route(state, papers).to,
      0,
      (sum, [, group]) => sum + group.length,
    );
    const ceiling = Option.match(last, { onNone: () => one, onSome: (parcel) => parcel.value });
    const value =
      continuingPapers === 0
        ? Rational.fromBigInt(0n)
        : Rational.min(Rational.makeUnsafe(BigInt(surplus), BigInt(continuingPapers)), ceiling);
    return transfer(
      rest,
      { _tag: "Surplus", candidate, transferValue: value },
      Option.some(candidate),
      papers,
      value,
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
    const groups: ReadonlyArray<readonly [Rational.Rational, ReadonlyArray<Parcel>]> =
      Arr.isReadonlyArrayEmpty(values)
        ? [[one, []]]
        : Arr.map(values, (value) => [
            value,
            Arr.filter(parcels, (parcel) => Rational.equals(parcel.value, value)),
          ]);
    return Arr.reduce(groups, excluded, (current, [value, group]) =>
      current.elected.length >= current.seats
        ? current
        : transfer(
            current,
            { _tag: "Exclusion", candidate, transferValue: value },
            Option.some(candidate),
            Arr.flatMap(group, (parcel) => parcel.papers),
            value,
            Arr.reduce(group, 0, (sum, parcel) => sum + parcel.votes),
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

/**
 * Counts `ballots` for `election`.
 *
 * Fails with {@link InvalidElection} when the election cannot be counted, and
 * with {@link TieBreak.TieUnresolved} when a tie reaches a tie rule that
 * refuses it.
 *
 * @example
 * ```ts
 * import * as Effect from "effect/Effect";
 * import { Choice, HareClark } from "@thomasfosterau/effect-choice";
 *
 * const [a, b, c] = ["a", "b", "c"].map(Choice.AlternativeId);
 * const result = HareClark.count(
 *   { seats: 2, candidates: [{ id: a, name: "A" }, { id: b, name: "B" }, { id: c, name: "C" }] },
 *   [[a, b], [a, c], [b], [c, b]],
 * );
 * ```
 *
 * @since 0.1.0
 */
export const count = (
  election: Election,
  ballots: ReadonlyArray<Ballot>,
): Effect.Effect<Result, InvalidElection | TieBreak.TieUnresolved> =>
  Effect.gen(function* () {
    const ids = Arr.map(election.candidates, (candidate) => candidate.id);
    if (!Number.isInteger(election.seats) || election.seats < 1) {
      return yield* new InvalidElection({ reason: "seats must be a positive integer" });
    }
    if (Arr.dedupe(ids).length !== ids.length) {
      return yield* new InvalidElection({ reason: "candidate identifiers must be unique" });
    }
    if (ids.length < election.seats) {
      return yield* new InvalidElection({ reason: "there are fewer candidates than seats" });
    }
    const minimum = Math.max(1, election.minimumPreferences ?? 1);
    const valid = Arr.map(ballots, (ballot) => validPreferences(ballot, ids));
    const formal = Arr.filter(valid, (ballot) => ballot.length >= minimum);
    const informal = valid.length - formal.length;
    const initial: State = {
      seats: election.seats,
      quota: quota(formal.length, election.seats),
      order: ids,
      status: R.fromEntries(Arr.map(ids, (id) => [id, continuingStatus] as const)),
      parcels: {},
      totals: R.fromEntries(Arr.map(ids, (id) => [id, 0] as const)),
      setAside: 0,
      elected: [],
      excluded: [],
      surpluses: [],
      counts: [],
    };
    const first = transfer(
      initial,
      { _tag: "FirstPreferences" },
      Option.none(),
      Arr.map(formal, (ballot): Paper => ({ ballot, at: -1 })),
      one,
      formal.length,
    );
    const final = yield* step(first);
    return {
      formal: formal.length,
      informal,
      quota: final.quota,
      elected: final.elected,
      excluded: final.excluded,
      counts: final.counts,
    };
  }).pipe(Effect.withSpan("HareClark.count"));

/**
 * A Hare-Clark election as a sealed {@link Choice.Mechanism}: voters'
 * ballots in, the declared result out.
 *
 * @since 0.1.0
 */
export const mechanism = (
  election: Election,
): Choice.Mechanism<Ballot, Result, InvalidElection | TieBreak.TieUnresolved> =>
  Choice.mechanism("HareClark", (ballots) => count(election, ballots));
