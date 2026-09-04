import { useState } from 'react';
import type { JudgementActionPayload, JudgementView } from '@bukharo/shared';

import { GameLog } from '../../components/GameLog';
import { Hand } from '../../components/Hand';
import { JudgementTableTop } from './JudgementTableTop';
import { ScoreBoard } from './ScoreBoard';
import { biddingSummary, isYourTurn, trumpLabel, unplayableCardIds, youAreBidding } from './rules';
import type { Bukharo } from '../../state/useBukharo';
import { isMuted, setMuted } from '../../sound';

export function JudgementTable({ app, view }: { app: Bukharo; view: JudgementView }) {
  const room = app.room!;
  const [selected, setSelected] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [showScores, setShowScores] = useState(false);
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

  const bidding = youAreBidding(view);

  const turnMessage = (): string => {
    if (view.status === 'MATCH_END') return 'Match over';
    if (view.status === 'ROUND_END') return 'Round over';
    if (view.status === 'BIDDING') {
      return bidding
        ? 'Look at your hand, then judge'
        : `Waiting for ${onTurnName} to judge…`;
    }
    return yourTurn ? 'Your turn — play a card' : `Waiting for ${onTurnName}…`;
  };

  const you = view.you;

  return (
    <main className="screen screen--table screen--judgement">
      <header className="topbar">
        <div className="topbar__bucharoo">
          <span className="topbar__label">Trump</span>
          <span className="topbar__bucharooState">{trumpLabel(view.trump)}</span>
        </div>

        <div className="topbar__scores">
          {you && (
            <>
              <span className="jchip" title="Your judgement this round">
                B: {you.bid ?? '–'}
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
          <button
            type="button"
            className="iconButton"
            onClick={() => setShowScores(true)}
            aria-label="Score board"
          >
            📊
          </button>
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

      <p className={`turnbar ${yourTurn || bidding ? 'is-yours' : ''}`} role="status" aria-live="polite">
        {turnMessage()}
      </p>

      {/* Everyone around the table, with the trick in the middle. */}
      <JudgementTableTop view={view} connected={connected} />

      <p className="mtally">
        {view.cardsEach} card{view.cardsEach === 1 ? '' : 's'} each · {biddingSummary(view)}
      </p>

      {you && (
        <Hand
          cards={you.hand}
          unplayableIds={view.status === 'PLAYING' ? unplayable : []}
          selectedIds={selected ? [selected] : []}
          isYourTurn={yourTurn && view.status === 'PLAYING'}
          onToggle={(cardId) => setSelected((current) => (current === cardId ? null : cardId))}
        />
      )}

      {/*
        Bidding happens below the hand, not over it. It used to be a modal,
        which meant the first player to judge was asked for a number before
        they had seen a single one of their cards.
      */}
      {bidding && <BidBar view={view} onBid={(bid) => send({ type: 'PLACE_BID', bid })} />}

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

      {showLog && <GameLog log={view.log} onClose={() => setShowLog(false)} />}
      {showScores && <ScoreBoard view={view} onClose={() => setShowScores(false)} />}

      {(view.status === 'ROUND_END' || view.status === 'MATCH_END') && (
        <ScoreBoard view={view} isResult isHost={isHost} app={app} />
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
 * The judgement itself, as a bar rather than a dialog.
 *
 * Every number is shown, and the one the last-bidder rule forbids is struck
 * through and disabled with the reason on it — being told why you cannot say
 * "two" is most of understanding the rule.
 */
function BidBar({ view, onBid }: { view: JudgementView; onBid(bid: number): void }) {
  const all = Array.from({ length: view.cardsEach + 1 }, (_, i) => i);
  const legal = new Set(view.yourLegalBids);
  const isLast = view.players.filter((p) => p.bid !== null).length === view.players.length - 1;

  return (
    <section className="bidbar" aria-label="Place your judgement">
      <h2 className="bidbar__title">
        How many of the {view.cardsEach} will you take?
      </h2>
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
          You judge last, so you cannot make the total come to {view.cardsEach} — somebody has to be
          wrong.
        </p>
      )}
    </section>
  );
}
