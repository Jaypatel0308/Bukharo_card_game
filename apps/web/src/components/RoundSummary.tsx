import type { GameView, TeamId } from '@bukharo/game-engine';
import type { RoomView } from '@bukharo/shared';

import type { Bukharo } from '../state/useBukharo';

interface Props {
  app: Bukharo;
  room: RoomView;
  game: GameView;
}

/** Shown between rounds and at the end of the match (§30, §68). */
export function RoundSummary({ app, room, game }: Props) {
  const record = game.scoreHistory[game.scoreHistory.length - 1];
  const isHost = room.players.find((p) => p.id === room.youId)?.isHost ?? false;
  const matchOver = room.status === 'MATCH_END';
  const winner = game.winningTeamId;

  const share = async (): Promise<void> => {
    const text = `Bukharo — Team A ${game.teams.TEAM_A.matchScore}, Team B ${game.teams.TEAM_B.matchScore}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Bukharo result', text });
      else await navigator.clipboard.writeText(text);
    } catch {
      /* dismissed */
    }
  };

  return (
    <div className="modal modal--full" role="dialog" aria-modal="true" aria-label={matchOver ? 'Match result' : 'Round result'}>
      <div className="modal__body modal__body--wide">
        {matchOver ? (
          <>
            <h2 className="result__title">
              {winner ? `${winner === 'TEAM_A' ? 'Team A' : 'Team B'} wins` : 'Match drawn'}
            </h2>
            <p className="result__scores">
              Team A {game.teams.TEAM_A.matchScore.toLocaleString()} · Team B{' '}
              {game.teams.TEAM_B.matchScore.toLocaleString()}
            </p>
          </>
        ) : (
          <h2 className="result__title">Round {record?.roundNumber ?? game.roundNumber} complete</h2>
        )}

        {record && (
          <div className="result__grid">
            {(['TEAM_A', 'TEAM_B'] as TeamId[]).map((teamId) => {
              const score = record.teams[teamId];
              return (
                <section key={teamId} className="result__team">
                  <h3>{teamId === 'TEAM_A' ? 'Team A' : 'Team B'}</h3>
                  <ul className="result__lines">
                    <li>
                      <span>Card points</span>
                      <span>+{score.cardPoints}</span>
                    </li>
                    <li>
                      <span>Clean Bucharos ({score.breakdown.cleanBucharos})</span>
                      <span>+{score.cleanBucharoBonus}</span>
                    </li>
                    <li>
                      <span>Dirty Bucharos ({score.breakdown.dirtyBucharos})</span>
                      <span>+{score.dirtyBucharoBonus}</span>
                    </li>
                    <li>
                      <span>Bucharoo</span>
                      <span>+{score.bucharooBonus}</span>
                    </li>
                    <li>
                      <span>Going out</span>
                      <span>+{score.goingOutBonus}</span>
                    </li>
                    <li>
                      <span>Cards left in hand ({score.breakdown.cardsLeftInHands})</span>
                      <span>−{score.handPenalty}</span>
                    </li>
                    <li className="result__total">
                      <span>Round total</span>
                      <span>{score.roundTotal}</span>
                    </li>
                    <li className="result__match">
                      <span>Match total</span>
                      <span>{score.matchTotalAfter}</span>
                    </li>
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        <div className="modal__actions modal__actions--stack">
          {matchOver ? (
            <>
              {isHost && (
                <button type="button" className="button button--primary" onClick={app.restartMatch}>
                  Play again
                </button>
              )}
              <button type="button" className="button" onClick={() => void share()}>
                Share result
              </button>
              <button type="button" className="button button--ghost" onClick={app.leaveRoom}>
                Leave room
              </button>
            </>
          ) : isHost ? (
            <button type="button" className="button button--primary" onClick={app.nextRound}>
              Deal next round
            </button>
          ) : (
            <p className="hint">Waiting for the host to deal the next round…</p>
          )}
        </div>
      </div>
    </div>
  );
}
