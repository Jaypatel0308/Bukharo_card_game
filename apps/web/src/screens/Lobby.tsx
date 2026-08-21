import { useState } from 'react';
import { TARGET_SCORE_OPTIONS, describeGame, teamForPosition } from '@bukharo/shared';

import { TeamNameField } from '../components/TeamNameField';
import { ThemePicker } from '../components/ThemePicker';
import type { Bukharo } from '../state/useBukharo';

const TEAMS: Array<'TEAM_A' | 'TEAM_B'> = ['TEAM_A', 'TEAM_B'];

export function Lobby({ app }: { app: Bukharo }) {
  const room = app.room!;
  const you = room.players.find((p) => p.id === room.youId);
  const isHost = Boolean(you?.isHost);
  const [copied, setCopied] = useState(false);
  const [confirmKick, setConfirmKick] = useState<string | null>(null);

  const game = describeGame(room.gameId);
  const seats = Array.from({ length: game.maxPlayers }, (_, position) => position);
  const inviteLink = `${window.location.origin}/join/${room.roomCode}`;
  const everyoneReady = room.players.length > 0 && room.players.every((p) => p.ready);
  const canStart = everyoneReady && room.cannotStartReason === null;
  const waitingOn = room.players.filter((p) => !p.ready).map((p) => p.displayName);

  const share = async (): Promise<void> => {
    const data = { title: 'Bukharo', text: `Join my Bukharo game — code ${room.roomCode}`, url: inviteLink };
    if (navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch {
        /* the player dismissed the sheet */
      }
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the code is on screen anyway */
    }
  };

  return (
    <main className="screen screen--lobby">
      <header className="lobby__header">
        <p className="lobby__eyebrow">Room code</p>
        <p className="lobby__code">{room.roomCode}</p>
        <button type="button" className="button button--ghost" onClick={() => void share()}>
          {copied ? 'Link copied' : 'Copy invite link'}
        </button>
      </header>

      <div className="panel">
        <h2 className="panel__title">
          {game.name} · {room.players.length}/{game.maxPlayers}
        </h2>
        <div className="seats">
          {seats.map((position) => {
            const occupant = room.players.find((p) => p.position === position);
            const isYou = occupant?.id === room.youId;
            const team = teamForPosition(position);
            return (
              <div key={position} className={`seat seat--${team.toLowerCase()}`}>
                <div className="seat__meta">
                  <span className="seat__position">{game.seatLabel(position, game.maxPlayers)}</span>
                  <span className="seat__team">{room.teamNames[team]}</span>
                </div>
                {occupant ? (
                  <div className="seat__player">
                    <span className="seat__name">
                      {occupant.ready ? '✓ ' : ''}
                      {occupant.displayName}
                      {isYou && <span className="seat__you"> (you)</span>}
                    </span>
                    <span className="seat__tags">
                      {occupant.isHost && <span className="tag">Host</span>}
                      {!occupant.connected && <span className="tag tag--warn">Away</span>}
                      {!occupant.ready && <span className="tag tag--muted">Not ready</span>}
                    </span>
                    {isHost && !isYou && (
                      <button
                        type="button"
                        className="button button--danger button--tiny"
                        onClick={() => setConfirmKick(occupant.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="seat__empty"
                    onClick={() => app.choosePosition(position)}
                    aria-label={`Sit at ${game.seatLabel(position, game.maxPlayers)}`}
                  >
                    Empty — tap to sit here
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="hint">Partners sit opposite each other. Tap an empty seat to move.</p>
      </div>

      <div className="panel">
        <h2 className="panel__title">Teams</h2>
        <div className="teamNames">
          {TEAMS.map((teamId) => (
            <div key={teamId} className="teamName">
              <span
                className={`teamName__swatch teamName__swatch--${teamId.toLowerCase()}`}
                aria-hidden="true"
              />
              {isHost ? (
                <TeamNameField
                  label={`Name for the ${teamId === 'TEAM_A' ? 'red' : 'blue'} team`}
                  value={room.teamNames[teamId]}
                  onCommit={(name) => app.setTeamName(teamId, name)}
                />
              ) : (
                <span className="teamName__static">{room.teamNames[teamId]}</span>
              )}
            </div>
          ))}
        </div>
        {isHost && <p className="hint">Only you can rename the teams.</p>}
      </div>

      {isHost && (
        <div className="panel">
          <h2 className="panel__title">Match target</h2>
          <div className="segmented">
            {TARGET_SCORE_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                className={`segmented__item ${room.targetScore === value ? 'is-active' : ''}`}
                aria-pressed={room.targetScore === value}
                onClick={() => app.setTargetScore(value)}
              >
                {value.toLocaleString()}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <h2 className="panel__title">Table theme</h2>
        <ThemePicker />
      </div>

      <div className="lobby__actions">
        <button
          type="button"
          className={`button button--block ${you?.ready ? 'button--ghost' : 'button--primary'}`}
          onClick={() => app.setReady(!you?.ready)}
        >
          {you?.ready ? "I'm not ready" : "I'm ready"}
        </button>

        {isHost && (
          <button
            type="button"
            className="button button--primary button--block"
            disabled={!canStart}
            onClick={app.startGame}
          >
            Start match
          </button>
        )}

        {!canStart && (
          <p className="hint" role="status">
            {room.cannotStartReason ?? `Waiting for ${waitingOn.join(', ')}.`}
          </p>
        )}

        <button type="button" className="button button--ghost button--block" onClick={app.leaveRoom}>
          Leave room
        </button>
      </div>

      {confirmKick && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Remove player">
          <div className="modal__body">
            <h2>Remove this player?</h2>
            <p>
              {room.players.find((p) => p.id === confirmKick)?.displayName} will be sent back to the home
              screen. They can rejoin with the room code.
            </p>
            <div className="modal__actions">
              <button type="button" className="button button--ghost" onClick={() => setConfirmKick(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => {
                  app.kickPlayer(confirmKick);
                  setConfirmKick(null);
                }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
