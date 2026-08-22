import type { MindiView } from '@bukharo/shared';

import { initialsOf } from '../../components/TopBar';

interface Props {
  view: MindiView;
  teamNames: Record<string, string>;
  connected: Map<string, boolean>;
}

/**
 * Everyone at the table, in seating order.
 *
 * A row rather than a ring: Mindi seats up to eight, and eight boxes arranged
 * around a phone screen would be too small to read. Seating order still shows
 * who plays after whom, which is what a player actually needs.
 */
export function MindiSeats({ view, teamNames, connected }: Props) {
  const seated = [...view.players].sort((a, b) => a.position - b.position);

  return (
    <ol className="mseats" aria-label="Players at the table">
      {seated.map((player) => {
        const team = player.teamId.toLowerCase();
        const isYou = player.id === view.you?.id;
        const onTurn = player.id === view.currentPlayerId;

        return (
          <li
            key={player.id}
            className={`mseat mseat--${team} ${onTurn ? 'is-active' : ''} ${isYou ? 'is-you' : ''}`}
          >
            <span className="mseat__top">
              <span className={`pip pip--${team}`}>{initialsOf(teamNames[player.teamId] ?? '')}</span>
              <span className="mseat__name">{isYou ? 'You' : player.displayName}</span>
            </span>
            <span className="mseat__meta">
              {player.handCount} card{player.handCount === 1 ? '' : 's'}
            </span>
            {player.id === view.chooserId && <span className="tag tag--muted">hid</span>}
            {connected.get(player.id) === false && <span className="tag tag--warn">away</span>}
          </li>
        );
      })}
    </ol>
  );
}
