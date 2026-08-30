import type { JudgementView } from '@bukharo/shared';

import { standingFor } from './rules';

/**
 * Everyone at the table, with the only two numbers that matter: what they
 * judged, and how close they are to it.
 *
 * There are no team colours here — Judgement is every player for themselves,
 * so a seat is coloured by whether that player is still on track.
 */
export function JudgementSeats({
  view,
  connected,
}: {
  view: JudgementView;
  connected: Map<string, boolean>;
}) {
  const others = view.players.filter((p) => p.id !== view.you?.id);

  return (
    <ul className="jseats">
      {others.map((player) => {
        const standing = standingFor(view, player.id);
        const onTurn = player.id === view.currentPlayerId;
        return (
          <li
            key={player.id}
            className={`jseat jseat--${standing} ${onTurn ? 'is-onTurn' : ''} ${
              connected.get(player.id) === false ? 'is-away' : ''
            }`}
          >
            <span className="jseat__name">
              {player.displayName}
              {player.id === view.dealerId && <span className="jseat__tag">D</span>}
            </span>
            <span className="jseat__tally">
              <span className="jseat__bid">{player.bid ?? '–'}</span>
              <span className="jseat__sep">/</span>
              <span className="jseat__won">{player.tricksWon}</span>
            </span>
            <span className="jseat__score">{player.score}</span>
          </li>
        );
      })}
    </ul>
  );
}
