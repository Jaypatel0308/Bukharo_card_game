import { useState } from 'react';
import type { JudgementActionPayload, JudgementView } from '@bukharo/shared';

import { GameLog } from '../../components/GameLog';
import { Hand } from '../../components/Hand';
import { JudgementSeats } from './JudgementSeats';
import { TrickArea } from './TrickArea';
import {
  biddingSummary,
  isYourTurn,
  trumpLabel,
  unplayableCardIds,
  youAreBidding,
} from './rules';
import type { Bukharo } from '../../state/useBukharo';
import { isMuted, setMuted } from '../../sound';

export function JudgementTable({ app, view }: { app: Bukharo; view: JudgementView }) {
  const room = app.room!;
  const [selected, setSelected] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [muted, setMutedState] = useState(isMuted);

  const yourTurn = isYourTurn(view);
  const unplayable = unplayableCardIds(view);
  const isHost = room.players.find((p) => p.id === room.youId)?.isHost ?? false;
  const connected = new Map(room.players.map((p) => [p.id, p.connected]));
  const onTurnName =
    view.players.find((p) => p.id === view.currentPlayerId)?.displayName ?? 'someone';

  /** Narrowed to this game, so the compiler catches an action it cannot take. */
  const send = (action: JudgementActionPayload): void => app.act(action);

  const play = (): void => {
    if (!selected) return;
    send({ type: 'PLAY_CARD', cardId: selected });
    setSelected(null);
  };

  const turnMessage = (): string => {
    if (view.status === 'MATCH_END') return 'Match over';
    if (view.status === 'ROUND_END') return 'Round over';
    if (view.status === 'BIDDING') {
      return youAreBidding(view) ? 'Your judgement — how many will you take?' : `Waiting for ${onTurnName} to judge…`;
    }
    return yourTurn ? 'Your turn — play a card' : `Waiting for ${onTurnName}…`;
  };

  const you = view.you;

  return (
    <main className="screen screen--table">
      <header className="topbar">
        <div className="topbar__bucharoo">
          <span className="topbar__label">Trump</span>
          <span className="topbar__bucharooState">{trumpLabel(view.trump)}</span>
        </div>

        <div className="topbar__scores">
          {you && (
            <>
              <span className="jchip" title="Your judgement this round">
                B: {you.bid ?? '—'}
              </span>
              <span className="jchip" title="Tricks you have taken">
                W: {you.tricksWon}
              </span>
              <span className="jchip" title="Your score">
                S: {you.score}
              </span>
            </>
          )}
          <span className="topbar__round">
            R {view.roundNumber}/{view.totalRounds}
          </span>
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

      <p className={`turnbar ${yourTurn ? 'is-yours' : ''}`} role="status" aria-live="polite">
        {turnMessage()}
      </p>

      <JudgementSeats view={view} connected={connected} />
      <TrickArea view={view} />

      <p className="mtally">
        {view.cardsEach} card{view.cardsEach === 1 ? '' : 's'} each · {biddingSummary(view)}
      </p>

      {you && (
        <Hand
          cards={you.hand}
          unplayableIds={unplayable}
          selectedIds={selected ? [selected] : []}
          isYourTurn={yourTurn && view.status === 'PLAYING'}
          onToggle={(cardId) => setSelected((current) => (current === cardId ? null : cardId))}
        />
      )}

      {view.status === 'PLAYING' && (
        <div className="actionbar">
          <div className="actionbar__row">
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
      )}

      {yourTurn && view.status === 'PLAYING' && unplayable.length > 0 && view.currentTrick.leadSuit && (
        <p className="hint hint--floating">
          {view.currentTrick.leadSuit} were led and you hold some, so those are your only cards.
        </p>
      )}

      {youAreBidding(view) && <BidPrompt view={view} onBid={(bid) => send({ type: 'PLACE_BID', bid })} />}

      {showLog && <GameLog log={view.log} onClose={() => setShowLog(false)} />}

      {(view.status === 'ROUND_END' || view.status === 'MATCH_END') && (
        <RoundResultPanel app={app} view={view} isHost={isHost} />
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

/**
 * The judgement itself.
 *
 * Every number is shown, and the one the last-bidder rule forbids is disabled
 * with the reason on it rather than quietly missing — being told why you
 * cannot say "two" is most of understanding the rule.
 */
function BidPrompt({ view, onBid }: { view: JudgementView; onBid(bid: number): void }) {
  const all = Array.from({ length: view.cardsEach + 1 }, (_, i) => i);
  const legal = new Set(view.yourLegalBids);
  const isLast = view.players.filter((p) => p.bid !== null).length === view.players.length - 1;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Your judgement">
      <div className="modal__body modal__body--wide">
        <h2>How many will you take?</h2>
        <p className="hint">
          {view.cardsEach} trick{view.cardsEach === 1 ? '' : 's'} this round, {trumpLabel(view.trump)}{' '}
          trump. Exactly right scores; close scores nothing.
        </p>

        <div className="bidGrid">
          {all.map((bid) => {
            const allowed = legal.has(bid);
            return (
              <button
                key={bid}
                type="button"
                className={`bidChoice ${allowed ? '' : 'is-forbidden'}`}
                disabled={!allowed}
                title={allowed ? undefined : 'That would make the judgements add up exactly'}
                onClick={() => onBid(bid)}
              >
                {bid}
              </button>
            );
          })}
        </div>

        {isLast && (
          <p className="hint">
            You are last to judge, so you cannot make the total come to {view.cardsEach} — somebody
            has to be wrong.
          </p>
        )}
      </div>
    </div>
  );
}

function RoundResultPanel({
  app,
  view,
  isHost,
}: {
  app: Bukharo;
  view: JudgementView;
  isHost: boolean;
}) {
  const result = view.roundHistory[view.roundHistory.length - 1];
  if (!result) return null;
  const over = view.status === 'MATCH_END';
  const winners = view.players.filter((p) => view.winnerPlayerIds.includes(p.id));
  const standings = [...view.players].sort((a, b) => b.score - a.score);

  return (
    <div className="modal modal--full" role="dialog" aria-modal="true" aria-label={over ? 'Match result' : 'Round result'}>
      <div className="modal__body modal__body--wide">
        <h2 className="result__title">
          {over
            ? winners.length === 1
              ? `${winners[0]!.displayName} wins`
              : `${winners.map((w) => w.displayName).join(' and ')} share the win`
            : `Round ${result.roundNumber} — ${trumpLabel(result.trump)} trump`}
        </h2>

        <table className="scoreTable">
          <thead>
            <tr>
              <th>Player</th>
              <th>Judged</th>
              <th>Took</th>
              <th>Round</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((player) => {
              const line = result.lines.find((l) => l.playerId === player.id);
              const made = line ? line.scored > 0 : false;
              return (
                <tr key={player.id} className={made ? 'is-made' : 'is-missed'}>
                  <td>{player.displayName}</td>
                  <td>{line?.bid ?? '—'}</td>
                  <td>{line?.tricksWon ?? '—'}</td>
                  <td>{line ? (made ? `+${line.scored}` : '0') : '—'}</td>
                  <td>
                    <strong>{player.score}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

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
              Deal round {result.roundNumber + 1}
            </button>
          ) : (
            <p className="hint">Waiting for the host to deal the next round…</p>
          )}
        </div>
      </div>
    </div>
  );
}
