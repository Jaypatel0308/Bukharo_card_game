import { useState } from 'react';
import type { MindiActionPayload, MindiView } from '@bukharo/shared';

import { GameLog } from '../../components/GameLog';
import { Hand } from '../../components/Hand';
import { initialsOf } from '../../ui/teams';
import { MindiSeats } from './MindiSeats';
import { TrickArea } from './TrickArea';
import { canRevealTrump, isYourTurn, unplayableCardIds, youAreChoosing } from './rules';
import type { Bukharo } from '../../state/useBukharo';
import { isMuted, setMuted } from '../../sound';

const TEAM_IDS = ['TEAM_A', 'TEAM_B'] as const;

export function MindiTable({ app, view }: { app: Bukharo; view: MindiView }) {
  const room = app.room!;
  const teamNames = room.teamNames;
  const [selected, setSelected] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [muted, setMutedState] = useState(isMuted);

  const yourTurn = isYourTurn(view);
  const unplayable = unplayableCardIds(view);
  const mayReveal = canRevealTrump(view);
  const isHost = room.players.find((p) => p.id === room.youId)?.isHost ?? false;
  const connected = new Map(room.players.map((p) => [p.id, p.connected]));
  const onTurnName =
    view.players.find((p) => p.id === view.currentPlayerId)?.displayName ?? 'someone';

  /** Narrowed to this game, so the compiler catches an action Mindi cannot take. */
  const send = (action: MindiActionPayload): void => app.act(action);

  const play = (): void => {
    if (!selected) return;
    send({ type: 'PLAY_CARD', cardId: selected });
    setSelected(null);
  };

  const turnMessage = (): string => {
    if (view.status === 'MATCH_END') return 'Match over';
    if (view.status === 'HAND_END') return 'Hand over';
    if (view.status === 'CHOOSING_MODE') {
      return youAreChoosing(view)
        ? 'Your call — hide a card, or play Katte'
        : `Waiting for ${view.players.find((p) => p.id === view.chooserId)?.displayName ?? 'the chooser'}…`;
    }
    return yourTurn ? 'Your turn — play a card' : `Waiting for ${onTurnName}…`;
  };

  return (
    <main className="screen screen--table">
      <header className="topbar">
        <div className="topbar__bucharoo">
          <span className="topbar__label">Kot</span>
          <span className="topbar__bucharooState">
            {view.teams.TEAM_A.kot}–{view.teams.TEAM_B.kot} of {view.kotTarget}
          </span>
        </div>

        <div className="topbar__scores">
          {TEAM_IDS.map((teamId) => (
            <span key={teamId} className={`topbar__team topbar__team--${teamId.toLowerCase()}`}>
              <span className={`pip pip--${teamId.toLowerCase()}`}>
                {initialsOf(teamNames[teamId])}
              </span>
              <strong className="topbar__teamScore">{view.teams[teamId].mindisThisHand}</strong>
            </span>
          ))}
          <span className="topbar__round">H{view.handNumber}</span>
        </div>

        <div className="topbar__buttons">
          <button type="button" className="iconButton" onClick={() => setShowLog(true)} aria-label="Game log">
            ☰
          </button>
          <button
            type="button"
            className="iconButton"
            aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
            aria-pressed={!muted}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              setMutedState(next);
            }}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button type="button" className="iconButton" onClick={() => setConfirmLeave(true)} aria-label="Leave game">
            ✕
          </button>
        </div>
      </header>

      <p className={`turnbar ${yourTurn || youAreChoosing(view) ? 'is-yours' : ''}`} role="status" aria-live="polite">
        {turnMessage()}
      </p>

      <MindiSeats view={view} teamNames={teamNames} connected={connected} />
      <TrickArea view={view} />

      <p className="mtally">
        Mindis this hand — {teamNames.TEAM_A} {view.teams.TEAM_A.mindisThisHand}, {teamNames.TEAM_B}{' '}
        {view.teams.TEAM_B.mindisThisHand} · tricks {view.teams.TEAM_A.tricksThisHand}–
        {view.teams.TEAM_B.tricksThisHand}
      </p>

      {view.you && (
        <Hand
          cards={view.you.hand}
          unplayableIds={unplayable}
          selectedIds={selected ? [selected] : []}
          isYourTurn={yourTurn}
          onToggle={(cardId) => setSelected((current) => (current === cardId ? null : cardId))}
        />
      )}

      <div className="actionbar">
        <div className="actionbar__row">
          <button
            type="button"
            className="button"
            disabled={!mayReveal}
            onClick={() => send({ type: 'REVEAL_TRUMP' })}
          >
            Call for trump
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={!yourTurn || !selected || unplayable.includes(selected)}
            onClick={play}
          >
            Play card
          </button>
          <button
            type="button"
            className="button button--ghost"
            disabled={!selected}
            onClick={() => setSelected(null)}
          >
            Clear
          </button>
        </div>
      </div>

      {yourTurn && unplayable.length > 0 && view.currentTrick.leadSuit && (
        <p className="hint hint--floating">
          {view.currentTrick.leadSuit} were led, and you hold some — those are the only cards you may
          play.
        </p>
      )}
      {mayReveal && (
        <p className="hint hint--floating">
          You cannot follow suit. You may call for the face-down card, or let it lie.
        </p>
      )}

      {youAreChoosing(view) && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="How is trump set?">
          <div className="modal__body">
            <h2>How is trump set this hand?</h2>
            <p>
              Hide a card and its suit becomes trump only if someone calls for it. Or play Katte, and
              the first card off suit decides.
            </p>
            <div className="modal__actions modal__actions--stack">
              <button
                type="button"
                className="button button--primary"
                onClick={() => send({ type: 'CHOOSE_MODE', mode: 'HIDDEN' })}
              >
                Hide a card
              </button>
              <button
                type="button"
                className="button"
                onClick={() => send({ type: 'CHOOSE_MODE', mode: 'KATTE' })}
              >
                Play Katte
              </button>
            </div>
          </div>
        </div>
      )}

      {view.yourHiddenCard && !view.hiddenRevealed && (
        <p className="hint hint--floating">
          You hid {view.yourHiddenCard.rank} of {view.yourHiddenCard.suit}. Nobody else can see it.
        </p>
      )}

      {showLog && <GameLog log={view.log} onClose={() => setShowLog(false)} />}

      {(view.status === 'HAND_END' || view.status === 'MATCH_END') && (
        <HandResult app={app} view={view} isHost={isHost} teamNames={teamNames} />
      )}

      {confirmLeave && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Leave game">
          <div className="modal__body">
            <h2>Leave this game?</h2>
            <p>Your seat is held for you — you can come back with the room code on this device.</p>
            <div className="modal__actions">
              <button type="button" className="button button--ghost" onClick={() => setConfirmLeave(false)}>
                Keep playing
              </button>
              <button type="button" className="button button--danger" onClick={app.leaveRoom}>
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function HandResult({
  app,
  view,
  isHost,
  teamNames,
}: {
  app: Bukharo;
  view: MindiView;
  isHost: boolean;
  teamNames: Record<string, string>;
}) {
  const result = view.handHistory[view.handHistory.length - 1];
  if (!result) return null;

  const over = view.status === 'MATCH_END';
  const loser = view.losingTeamId;
  const winner = loser ? (loser === 'TEAM_A' ? 'TEAM_B' : 'TEAM_A') : null;

  return (
    <div className="modal modal--full" role="dialog" aria-modal="true" aria-label={over ? 'Match result' : 'Hand result'}>
      <div className="modal__body modal__body--wide">
        <h2 className="result__title">
          {over && winner
            ? `${teamNames[winner]} win the match`
            : `${teamNames[result.winningTeamId]} won hand ${result.handNumber}`}
        </h2>

        <p className="result__scores">
          Mindis {result.mindis.TEAM_A}–{result.mindis.TEAM_B}
          {result.decidedBy === 'TRICKS' &&
            ` · decided on tricks ${result.tricks.TEAM_A}–${result.tricks.TEAM_B}`}
          {result.sweep && ' · a clean sweep'}
        </p>

        <div className="result__grid">
          {TEAM_IDS.map((teamId) => (
            <section key={teamId} className={`result__team result__team--${teamId.toLowerCase()}`}>
              <h3>{teamNames[teamId]}</h3>
              <ul className="result__lines">
                <li>
                  <span>Mindis</span>
                  <span>{result.mindis[teamId]}</span>
                </li>
                <li>
                  <span>Tricks</span>
                  <span>{result.tricks[teamId]}</span>
                </li>
                <li className="result__total">
                  <span>Kot</span>
                  <span>
                    {result.kotAfter[teamId]} of {view.kotTarget}
                  </span>
                </li>
              </ul>
            </section>
          ))}
        </div>

        <div className="modal__actions modal__actions--stack">
          {over ? (
            <>
              {isHost && (
                <button type="button" className="button button--primary" onClick={app.restartMatch}>
                  Play again
                </button>
              )}
              <button type="button" className="button button--ghost" onClick={app.leaveRoom}>
                Leave room
              </button>
            </>
          ) : isHost ? (
            <button type="button" className="button button--primary" onClick={app.nextRound}>
              Deal the next hand
            </button>
          ) : (
            <p className="hint">Waiting for the host to deal the next hand…</p>
          )}
        </div>
      </div>
    </div>
  );
}
