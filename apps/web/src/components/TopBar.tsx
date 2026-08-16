import type { GameView, TeamId } from '@bukharo/game-engine';

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

/** Up to two letters, so a renamed team still has a compact marker. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
