import type { GameView } from '@bukharo/game-engine';

export function Scoreboard({ game, onClose }: { game: GameView; onClose(): void }) {
  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label="Scoreboard">
      <div className="drawer__body">
        <header className="drawer__header">
          <h2>Scoreboard</h2>
          <button type="button" className="iconButton" onClick={onClose} aria-label="Close scoreboard">
            ✕
          </button>
        </header>

        <p className="drawer__note">Playing to {game.targetScore.toLocaleString()} points.</p>

        <table className="scoretable">
          <thead>
            <tr>
              <th scope="col">Round</th>
              <th scope="col">Team A</th>
              <th scope="col">Team B</th>
            </tr>
          </thead>
          <tbody>
            {game.scoreHistory.map((record) => (
              <tr key={record.roundNumber}>
                <th scope="row">{record.roundNumber}</th>
                <td>{record.teams.TEAM_A.roundTotal}</td>
                <td>{record.teams.TEAM_B.roundTotal}</td>
              </tr>
            ))}
            {game.scoreHistory.length === 0 && (
              <tr>
                <td colSpan={3} className="scoretable__empty">
                  No completed rounds yet.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td>{game.teams.TEAM_A.matchScore}</td>
              <td>{game.teams.TEAM_B.matchScore}</td>
            </tr>
          </tfoot>
        </table>

        {game.scoreHistory.length > 0 && (
          <details className="breakdown">
            <summary>Round breakdowns</summary>
            {[...game.scoreHistory].reverse().map((record) => (
              <div key={record.roundNumber} className="breakdown__round">
                <h3>
                  Round {record.roundNumber} · wild {record.wildRank}
                </h3>
                {(['TEAM_A', 'TEAM_B'] as const).map((teamId) => {
                  const score = record.teams[teamId];
                  return (
                    <dl key={teamId} className="breakdown__list">
                      <dt className="breakdown__team">{teamId === 'TEAM_A' ? 'Team A' : 'Team B'}</dt>
                      <dd>
                        <Row label="Card points" value={score.cardPoints} />
                        <Row label="Clean Bucharos" value={score.cleanBucharoBonus} />
                        <Row label="Dirty Bucharos" value={score.dirtyBucharoBonus} />
                        <Row label="Bucharoo" value={score.bucharooBonus} />
                        <Row label="Going out" value={score.goingOutBonus} />
                        <Row label="Cards left in hand" value={-score.handPenalty} />
                        <Row label="Round total" value={score.roundTotal} strong />
                      </dd>
                    </dl>
                  );
                })}
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  if (value === 0 && !strong) return null;
  return (
    <span className={`breakdown__row ${strong ? 'is-total' : ''}`}>
      <span>{label}</span>
      <span>
        {value > 0 && !strong ? '+' : ''}
        {value}
      </span>
    </span>
  );
}
