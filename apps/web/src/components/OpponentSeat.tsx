import type { GameView, TeamId } from '@bukharo/game-engine';

import { initialsOf } from './TopBar';
import { SEAT_LABEL } from '../ui/cards';

interface Props {
  player: GameView['players'][number] | null;
  game: GameView;
  position: 'top' | 'left' | 'right';
  connected: boolean;
  teamNames: Record<TeamId, string>;
}

export function OpponentSeat({ player, game, position, connected, teamNames }: Props) {
  if (!player) return <div className={`opponent opponent--${position} is-empty`} />;

  const isActive = game.currentPlayerId === player.id;
  const team = player.teamId.toLowerCase();

  return (
    <div className={`opponent opponent--${position} opponent--${team} ${isActive ? 'is-active' : ''}`}>
      <span className="opponent__name">{player.displayName}</span>
      <span className="opponent__meta">
        <span className={`pip pip--${team}`}>{initialsOf(teamNames[player.teamId])}</span>
        <span className="opponent__cards">{player.handCount} cards</span>
      </span>
      <span className="opponent__seat">{SEAT_LABEL[player.seat]}</span>
      {!connected && <span className="tag tag--warn">Disconnected</span>}
      {player.handType === 'BUCHAROO' && <span className="tag tag--good">On Bucharoo</span>}
      {isActive && <span className="opponent__turn" aria-label="Playing now" />}
    </div>
  );
}
