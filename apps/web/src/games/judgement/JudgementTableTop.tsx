import type { JudgementView } from '@bukharo/shared';

import { PlayingCard } from '../../components/PlayingCard';
import { seatAngles, seatPoint, standingFor } from './rules';

/**
 * The table itself: everyone sitting round an oval, with the trick in the
 * middle and each played card lying in front of whoever played it.
 *
 * Positions are computed from an angle per seat rather than fixed slots,
 * because the table takes anywhere from two to ten players. The viewer is
 * always at the bottom, so the player on your left is on your left.
 */
export function JudgementTableTop({
  view,
  connected,
}: {
  view: JudgementView;
  connected: Map<string, boolean>;
}) {
  const angles = seatAngles(view);
  const others = view.players.filter((p) => p.id !== view.you?.id);

  // The trick on display: the one being played, or the one just finished so
  // the table can see who took it before it clears.
  const showing =
    view.currentTrick.plays.length > 0
      ? { plays: view.currentTrick.plays, winnerPlayerId: null as string | null }
      : view.lastTrick
        ? { plays: view.lastTrick.plays, winnerPlayerId: view.lastTrick.winnerPlayerId }
        : { plays: [], winnerPlayerId: null as string | null };

  const nameOf = (id: string): string =>
    view.players.find((p) => p.id === id)?.displayName ?? 'someone';

  return (
    <div className="jtable" aria-label="The table">
      <div className="jtable__felt" />

      {others.map((player) => {
        const angle = angles.get(player.id) ?? 270;
        const { x, y } = seatPoint(angle, 40, 34);
        const standing = standingFor(view, player.id);
        return (
          <div
            key={player.id}
            className={`jseat jseat--${standing} ${
              player.id === view.currentPlayerId ? 'is-onTurn' : ''
            } ${connected.get(player.id) === false ? 'is-away' : ''}`}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <span className="jseat__name">
              {player.displayName}
              {player.id === view.dealerId && <span className="jseat__tag">D</span>}
            </span>
            <span className="jseat__chips">
              <span className="jseat__chip jseat__chip--bid">B:{player.bid ?? '–'}</span>
              <span className="jseat__chip jseat__chip--won">W:{player.tricksWon}</span>
            </span>
            <span className="jseat__score">{player.score}</span>
          </div>
        );
      })}

      {/* Each card lies in front of the player who put it there. */}
      {showing.plays.map((play) => {
        const angle = angles.get(play.playerId) ?? 90;
        const { x, y } = seatPoint(angle, 20, 17);
        return (
          <div
            key={`${play.playerId}-${play.card.id}`}
            className={`jplay ${showing.winnerPlayerId === play.playerId ? 'is-winner' : ''}`}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <PlayingCard card={play.card} size="sm" />
          </div>
        );
      })}

      {showing.plays.length === 0 && (
        <p className="jtable__empty">
          {view.status === 'BIDDING' ? 'Judging…' : 'Waiting for the lead'}
        </p>
      )}
      {showing.winnerPlayerId && (
        <p className="jtable__result">{nameOf(showing.winnerPlayerId)} took it</p>
      )}
    </div>
  );
}
