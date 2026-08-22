import type { GameView, TeamId } from '@bukharo/game-engine';

import { initialsOf } from '../../ui/teams';

interface Props {
  game: GameView;
  teamNames: Record<TeamId, string>;
  muted: boolean;
  onToggleMute(): void;
  onOpenScores(): void;
  onOpenLog(): void;
  onLeave(): void;
}

/** Match state at a glance: Bucharoo, both scores, round, and the utilities. */
export function TopBar({
  game,
  teamNames,
  muted,
  onToggleMute,
  onOpenScores,
  onOpenLog,
  onLeave,
}: Props) {
  const takenBy = game.bucharooTakenByTeamId;

  return (
    <header className="topbar">
      <div className="topbar__bucharoo">
        <span className="topbar__label">Bucharoo</span>
        <span className={`topbar__bucharooState ${game.bucharooTaken ? 'is-taken' : ''}`}>
          {game.bucharooTaken ? (takenBy ? teamNames[takenBy] : 'Taken') : `${game.bucharooCount} cards`}
        </span>
      </div>

      <div className="topbar__scores">
        {(['TEAM_A', 'TEAM_B'] as TeamId[]).map((teamId) => (
          <span key={teamId} className={`topbar__team topbar__team--${teamId.toLowerCase()}`}>
            <span className={`pip pip--${teamId.toLowerCase()}`}>{initialsOf(teamNames[teamId])}</span>
            <strong className="topbar__teamScore">{game.teams[teamId].matchScore}</strong>
          </span>
        ))}
        <span className="topbar__round">R{game.roundNumber}</span>
      </div>

      <div className="topbar__buttons">
        <button type="button" className="iconButton" onClick={onOpenScores} aria-label="Scoreboard">
          ▤
        </button>
        <button type="button" className="iconButton" onClick={onOpenLog} aria-label="Game log">
          ☰
        </button>
        <button
          type="button"
          className="iconButton"
          aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
          aria-pressed={!muted}
          onClick={onToggleMute}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button type="button" className="iconButton" onClick={onLeave} aria-label="Leave game">
          ✕
        </button>
      </div>
    </header>
  );
}
