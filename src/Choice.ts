/**
 * The shared model every mechanism in this package is built on: **actors**
 * express choices over **alternatives**, and a mechanism turns those choices
 * into an **outcome**.
 *
 * Mechanisms come in two shapes:
 *
 * - A {@link Mechanism} is _sealed_: every actor expresses a choice up front
 *   (a ballot, a sealed bid) without seeing anyone else's, and the mechanism
 *   resolves them all at once. Hare-Clark elections and bond tenders are
 *   sealed.
 * - A {@link Protocol} is _sequential_: the mechanism asks one actor at a
 *   time, and each answer changes what the next actor is asked. Drafts are
 *   sequential.
 *
 * Either way the actors' side is an {@link Agent}: an effectful function from
 * the question an actor is asked to the actor's answer. An agent can be a
 * fixed list of answers, a strategy, a user interface or a remote service.
 *
 * @since 0.1.0
 */
import * as Brand from "effect/Brand";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";
import * as Option from "effect/Option";

/**
 * Identifies an actor: someone who expresses a choice, such as a voter, a
 * bidder or a club.
 *
 * @since 0.1.0
 */
export type ActorId = string & Brand.Brand<"@thomasfosterau/effect-choice/ActorId">;

/**
 * Brands a string as an {@link ActorId}.
 *
 * @since 0.1.0
 */
export const ActorId: Brand.Constructor<ActorId> = Brand.nominal<ActorId>();

/**
 * Identifies an alternative: something actors choose between, such as a
 * candidate or a player.
 *
 * @since 0.1.0
 */
export type AlternativeId = string & Brand.Brand<"@thomasfosterau/effect-choice/AlternativeId">;

/**
 * Brands a string as an {@link AlternativeId}.
 *
 * @since 0.1.0
 */
export const AlternativeId: Brand.Constructor<AlternativeId> = Brand.nominal<AlternativeId>();

/**
 * A sealed mechanism: it takes every actor's expressed choice at once and
 * resolves them into an outcome.
 *
 * @since 0.1.0
 */
export interface Mechanism<in Expression, out Outcome, out E = never, out R = never> {
  /** A short name for the mechanism, used as the tracing span name. */
  readonly name: string;
  /** Resolves the actors' expressed choices into an outcome. */
  readonly resolve: (expressions: ReadonlyArray<Expression>) => Effect.Effect<Outcome, E, R>;
}

/**
 * Makes a {@link Mechanism} from its name and resolution function.
 *
 * @since 0.1.0
 */
export const mechanism = <Expression, Outcome, E = never, R = never>(
  name: string,
  resolve: (expressions: ReadonlyArray<Expression>) => Effect.Effect<Outcome, E, R>,
): Mechanism<Expression, Outcome, E, R> => ({ name, resolve });

/**
 * One question put to one actor.
 *
 * @since 0.1.0
 */
export interface Turn<out Prompt> {
  /** The actor being asked. */
  readonly actor: ActorId;
  /** What the actor is being asked. */
  readonly prompt: Prompt;
}

/**
 * The actors' side of a mechanism: answers the question in a {@link Turn}.
 *
 * @since 0.1.0
 */
export type Agent<in Prompt, out Response, out E = never, out R = never> = (
  turn: Turn<Prompt>,
) => Effect.Effect<Response, E, R>;

/**
 * A sequential mechanism, as a state machine: while {@link Protocol.next}
 * names a turn, the actor it names is asked, and their answer moves the state
 * on.
 *
 * @since 0.1.0
 */
export interface Protocol<in out State, out Prompt, in Response, out Outcome, out E = never> {
  /** A short name for the protocol, used as the tracing span name. */
  readonly name: string;
  /** The next question to ask, or `None` once the protocol has finished. */
  readonly next: (state: State) => Option.Option<Turn<Prompt>>;
  /** Moves the state on with an actor's answer, failing when the answer is not allowed. */
  readonly respond: (state: State, response: Response) => Effect.Effect<State, E>;
  /** The outcome of a finished protocol. */
  readonly finish: (state: State) => Outcome;
}

/**
 * Resolves `expressions` with the mechanism `self`, inside a span named after it.
 *
 * @since 0.1.0
 */
export const resolve: {
  <Expression>(
    expressions: ReadonlyArray<Expression>,
  ): <Outcome, E, R>(
    mechanism: Mechanism<Expression, Outcome, E, R>,
  ) => Effect.Effect<Outcome, E, R>;
  <Expression, Outcome, E, R>(
    mechanism: Mechanism<Expression, Outcome, E, R>,
    expressions: ReadonlyArray<Expression>,
  ): Effect.Effect<Outcome, E, R>;
} = dual(
  2,
  <Expression, Outcome, E, R>(
    self: Mechanism<Expression, Outcome, E, R>,
    expressions: ReadonlyArray<Expression>,
  ): Effect.Effect<Outcome, E, R> =>
    self.resolve(expressions).pipe(Effect.withSpan(`Choice.resolve ${self.name}`)),
);

/**
 * Asks each of `actors` the same `prompt` through `agent`, concurrently, and
 * resolves their answers with the mechanism `self`: a sealed mechanism run end to end.
 *
 * @since 0.1.0
 */
export const run = <Prompt, Expression, Outcome, E, R, E2, R2>(
  self: Mechanism<Expression, Outcome, E, R>,
  actors: ReadonlyArray<ActorId>,
  prompt: Prompt,
  agent: Agent<Prompt, Expression, E2, R2>,
): Effect.Effect<Outcome, E | E2, R | R2> =>
  Effect.forEach(actors, (actor) => agent({ actor, prompt }), { concurrency: "unbounded" }).pipe(
    Effect.flatMap((expressions) => resolve(self, expressions)),
  );

/**
 * Plays `protocol` from `initial` to the end, asking `agent` each question in
 * turn, and returns the outcome.
 *
 * @since 0.1.0
 */
export const play = <State, Prompt, Response, Outcome, E, E2, R2>(
  protocol: Protocol<State, Prompt, Response, Outcome, E>,
  initial: State,
  agent: Agent<Prompt, Response, E2, R2>,
): Effect.Effect<Outcome, E | E2, R2> => {
  const loop = (state: State): Effect.Effect<State, E | E2, R2> =>
    Option.match(protocol.next(state), {
      onNone: () => Effect.succeed(state),
      onSome: (turn) =>
        agent(turn).pipe(
          Effect.flatMap((response) => protocol.respond(state, response)),
          Effect.flatMap(loop),
        ),
    });
  return Effect.suspend(() => loop(initial)).pipe(
    Effect.map(protocol.finish),
    Effect.withSpan(`Choice.play ${protocol.name}`),
  );
};
