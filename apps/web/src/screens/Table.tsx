import { useMemo, useState } from 'react';
import { validateMeld, validateOpeningRun } from '@bukharo/game-engine';
import type { Card, GameView, Seat } from '@bukharo/game-engine';

import { CardBack, PlayingCard } from '../components/PlayingCard';
import { Hand } from '../components/Hand';
import { Melds } from '../components/Melds';
import { Scoreboard } from '../components/Scoreboard';
import { GameLog } from '../components/GameLog';
import { DiscardPileView } from '../components/DiscardPileView';
import { RoundSummary } from '../components/RoundSummary';
import { WildChooser } from '../components/WildChooser';
import type { Bukharo } from '../state/useBukharo';
import { SEAT_LABEL, SUIT_SYMBOL, cardLabel } from '../ui/cards';
import { isMuted, setMuted } from '../sound';

const CLOCKWISE: Seat[] = ['NORTH', 'EAST', 'SOUTH', 'WEST'];

/** Rotates the table so the viewer is always at the bottom (§36). */
function arrange(game: GameView, youSeat: Seat | null) {
  const base = youSeat ?? 'NORTH';
  const start = CLOCKWISE.indexOf(base);
  const seatAt = (offset: number): Seat => CLOCKWISE[(start + offset) % 4]!;
  const find = (seat: Seat) => game.players.find((p) => p.seat === seat) ?? null;
  return {
    bottom: find(seatAt(0)),
    left: find(seatAt(1)),
    top: find(seatAt(2)),
    right: find(seatAt(3)),
  };
}

type Drawer = 'none' | 'score' | 'log' | 'discard';

export function Table({ app }: { app: Bukharo }) {
  const room = app.room!;
  const game = room.game!;
  const you = game.you;

  const [selected, setSelected] = useState<string[]>([]);
  const [targetMeldId, setTargetMeldId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<Drawer>('none');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [muted, setMutedState] = useState(isMuted);

  const isYourTurn = you !== null && game.currentPlayerId === you.id;
  const phase = game.turnPhase;
  const yourTeam = you ? game.teams[you.teamId] : null;
  const teamOpened = yourTeam?.isOpened ?? false;
  const minimumMeld = teamOpened ? room.rules.normalMeldMinimum : room.rules.openingRunMinimum;
  const seats = useMemo(() => arrange(game, you?.seat ?? null), [game, you?.seat]);

  const activePlayer = game.players.find((p) => p.id === game.currentPlayerId);
  const connectedById = new Map(room.players.map((p) => [p.id, p.connected]));
  const waitingFor = room.waitingForPlayerId
    ? room.players.find((p) => p.id === room.waitingForPlayerId)
    : null;

  const clearSelection = (): void => {
    setSelected([]);
    setTargetMeldId(null);
  };

  const toggleCard = (cardId: string): void => {
    setSelected((current) =>
      current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId],
    );
  };

  const submit = (payload: Parameters<Bukharo['act']>[0]): void => {
    app.act(payload);
    clearSelection();
  };

  const canDraw = isYourTurn && phase === 'AWAITING_DRAW';
  const canPlay = isYourTurn && (phase === 'PLAYING_CARDS' || phase === 'AWAITING_DISCARD');
  const canSelectForMeld = canPlay && phase === 'PLAYING_CARDS';

  const selectedCards = useMemo(
    () =>
      selected
        .map((id) => you?.hand.find((c) => c.id === id))
        .filter((c): c is Card => Boolean(c)),
    [selected, you],
  );

  // The same engine the server runs, used here only to light the buttons up
  // honestly (§92). The server still validates every move for real.
  const meldPreview = useMemo(() => {
    if (!canSelectForMeld || selectedCards.length === 0) return null;
    const ctx = { wildRank: game.wildRank, rules: room.rules };
    return teamOpened ? validateMeld(selectedCards, ctx) : validateOpeningRun(selectedCards, ctx);
  }, [canSelectForMeld, selectedCards, teamOpened, game.wildRank, room.rules]);

  const addPreview = useMemo(() => {
    if (!canSelectForMeld || !teamOpened || selectedCards.length === 0 || !targetMeldId) return null;
    const meld = game.melds.find((m) => m.id === targetMeldId);
    if (!meld) return null;
    return validateMeld(
      [...meld.cards.map((c) => c.card), ...selectedCards],
      { wildRank: game.wildRank, rules: room.rules },
      meld.type,
    );
  }, [canSelectForMeld, teamOpened, selectedCards, targetMeldId, game.melds, game.wildRank, room.rules]);

  const canMeld = meldPreview?.ok === true;
  const canAddToMeld = addPreview?.ok === true;
  const canDiscard = canPlay && selected.length === 1;

  // Explain a rejected selection, but only once enough cards are chosen to
  // judge it — nagging about "needs 4 cards" after the first tap is noise.
  const meldProblem =
    selectedCards.length >= minimumMeld && meldPreview && !meldPreview.ok ? meldPreview.message : null;
  const addProblem =
    targetMeldId && selectedCards.length > 0 && addPreview && !addPreview.ok ? addPreview.message : null;

  const turnMessage = (): string => {
    if (room.status === 'ROUND_END') return 'Round over';
    if (room.status === 'MATCH_END') return 'Match over';
    if (waitingFor) return `Waiting for ${waitingFor.displayName} to reconnect…`;
    if (isYourTurn) {
      if (phase === 'AWAITING_DRAW') return 'Your turn — draw a card or take the pile';
      if (phase === 'AWAITING_DISCARD') return 'Your turn — discard to finish';
      return 'Your turn — meld, then discard';
    }
    return `Waiting for ${activePlayer?.displayName ?? 'the next player'}…`;
  };

  return (
    <main className="screen screen--table">
      <header className="topbar">
        <div className="topbar__wild">
          <span className="topbar__label">Wild</span>
          <strong className="topbar__wildRank">
            {game.wildRank ?? '—'}
            {game.wildCard && !game.wildCard.isJoker && (
              <span aria-hidden="true"> {SUIT_SYMBOL[game.wildCard.suit!]}</span>
            )}
          </strong>
          <span className="sr-only">
            All {game.wildRank ?? 'no'} cards and all jokers are wild this round.
          </span>
        </div>
        <div className="topbar__scores">
          <span className="score score--a">
            A <strong>{game.teams.TEAM_A.matchScore}</strong>
          </span>
          <span className="score score--b">
            B <strong>{game.teams.TEAM_B.matchScore}</strong>
          </span>
          <span className="topbar__round">R{game.roundNumber}</span>
        </div>
        <div className="topbar__buttons">
          <button type="button" className="iconButton" onClick={() => setDrawer('score')} aria-label="Scoreboard">
            ▤
          </button>
          <button type="button" className="iconButton" onClick={() => setDrawer('log')} aria-label="Game log">
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
          <button
            type="button"
            className="iconButton"
            onClick={() => setConfirmLeave(true)}
            aria-label="Leave game"
          >
            ✕
          </button>
        </div>
      </header>

      <p className={`turnbar ${isYourTurn ? 'is-yours' : ''}`} role="status" aria-live="polite">
        {turnMessage()}
      </p>

      <div className="table">
        <Opponent player={seats.top} game={game} position="top" connected={connectedById} />
        <div className="table__middle">
          <Opponent player={seats.left} game={game} position="left" connected={connectedById} />

          <div className="pileArea">
            <div className="pile">
              <CardBack count={game.stockCount} label={`Stock, ${game.stockCount} cards`} />
              <span className="pile__label">Stock</span>
            </div>

            <button
              type="button"
              className="pile pile--button"
              onClick={() => setDrawer('discard')}
              aria-label={
                game.discardPile.length === 0
                  ? 'Discard pile is empty'
                  : `Discard pile, ${game.discardPile.length} cards, top card ${
                      cardLabel(game.discardPile[game.discardPile.length - 1]!, game.wildRank)
                    }. Open to see them all.`
              }
            >
              {game.discardPile.length > 0 ? (
                <PlayingCard card={game.discardPile[game.discardPile.length - 1]!} wildRank={game.wildRank} />
              ) : (
                <div className="card card--empty" aria-hidden="true" />
              )}
              <span className="pile__label">Discard · {game.discardPile.length}</span>
            </button>

            <div className="pile">
              <div className={`bucharoo ${game.bucharooTaken ? 'is-taken' : ''}`} role="img" aria-label={
                game.bucharooTaken
                  ? `Bucharoo taken by ${game.bucharooTakenByTeamId === 'TEAM_A' ? 'Team A' : 'Team B'}`
                  : 'Bucharoo available, 13 cards'
              }>
                <span aria-hidden="true">{game.bucharooTaken ? '—' : game.bucharooCount}</span>
              </div>
              <span className="pile__label">
                {game.bucharooTaken
                  ? `Bucharoo · ${game.bucharooTakenByTeamId === 'TEAM_A' ? 'Team A' : 'Team B'}`
                  : 'Bucharoo'}
              </span>
            </div>
          </div>

          <Opponent player={seats.right} game={game} position="right" connected={connectedById} />
        </div>
      </div>

      <div className="meldArea">
        <Melds
          melds={game.melds}
          teamId="TEAM_A"
          title="Team A"
          isOpened={game.teams.TEAM_A.isOpened}
          wildRank={game.wildRank}
          canAdd={canPlay && you?.teamId === 'TEAM_A' && phase === 'PLAYING_CARDS'}
          selectableMeldId={targetMeldId}
          onSelectMeld={(id) => setTargetMeldId((current) => (current === id ? null : id))}
        />
        <Melds
          melds={game.melds}
          teamId="TEAM_B"
          title="Team B"
          isOpened={game.teams.TEAM_B.isOpened}
          wildRank={game.wildRank}
          canAdd={canPlay && you?.teamId === 'TEAM_B' && phase === 'PLAYING_CARDS'}
          selectableMeldId={targetMeldId}
          onSelectMeld={(id) => setTargetMeldId((current) => (current === id ? null : id))}
        />
      </div>

      {you && (
        <Hand
          cards={you.hand}
          wildRank={game.wildRank}
          selectedIds={selected}
          onToggle={toggleCard}
          disabled={!isYourTurn}
        />
      )}

      {/*
        Every button keeps a fixed position and a fixed meaning, enabled or
        disabled by the phase. Earlier the bar swapped its contents between
        draw and play, so a button could change identity under a waiting
        player's finger and a tap meant for "Open with 4+" drew a card.
      */}
      <div className="actionbar">
        <div className="actionbar__row">
          <button
            type="button"
            className="button button--primary"
            disabled={!canDraw}
            onClick={() => submit({ type: 'DRAW_STOCK' })}
          >
            Draw card
          </button>
          <button
            type="button"
            className="button"
            disabled={!canDraw || game.discardPile.length === 0}
            onClick={() => submit({ type: 'TAKE_DISCARD_PILE' })}
          >
            Take pile ({game.discardPile.length})
          </button>
          <button
            type="button"
            className="button"
            disabled={game.discardPile.length === 0}
            onClick={() => setDrawer('discard')}
          >
            See pile
          </button>
        </div>

        <div className="actionbar__row">
          <button
            type="button"
            className="button"
            disabled={!canMeld}
            onClick={() => submit({ type: 'CREATE_MELD', cardIds: selected })}
          >
            {teamOpened ? 'Create meld' : `Open with ${minimumMeld}+`}
          </button>
          <button
            type="button"
            className="button"
            disabled={!canAddToMeld}
            onClick={() => submit({ type: 'ADD_TO_MELD', meldId: targetMeldId!, cardIds: selected })}
          >
            Add to meld
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={!canDiscard}
            onClick={() => submit({ type: 'DISCARD', cardId: selected[0]! })}
          >
            Discard
          </button>
          <button
            type="button"
            className="button button--ghost"
            disabled={selected.length === 0 && !targetMeldId}
            onClick={clearSelection}
          >
            Clear
          </button>
        </div>
      </div>

      {canDraw && (
        <p className="hint hint--floating">
          Start your turn by drawing a card or taking the discard pile.
        </p>
      )}
      {meldProblem && <p className="hint hint--floating hint--problem">{meldProblem}</p>}
      {addProblem && <p className="hint hint--floating hint--problem">{addProblem}</p>}

      {canPlay && !teamOpened && (
        <p className="hint hint--floating">
          Your team is not open yet. Play a clean run of {room.rules.openingRunMinimum}+ cards in one suit —
          no wilds — before anything else.
        </p>
      )}

      {drawer === 'discard' && (
        <DiscardPileView
          cards={game.discardPile}
          wildRank={game.wildRank}
          onTake={canDraw ? () => {
            setDrawer('none');
            submit({ type: 'TAKE_DISCARD_PILE' });
          } : null}
          onClose={() => setDrawer('none')}
        />
      )}
      {drawer === 'score' && <Scoreboard game={game} onClose={() => setDrawer('none')} />}
      {drawer === 'log' && <GameLog log={game.log} onClose={() => setDrawer('none')} />}

      {(room.status === 'ROUND_END' || room.status === 'MATCH_END') && (
        <RoundSummary app={app} room={room} game={game} />
      )}

      {app.pendingWild && (
        <WildChooser
          options={app.pendingWild.options}
          onCancel={app.cancelWildChoice}
          onChoose={app.pendingWild.retry}
        />
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

function Opponent({
  player,
  game,
  position,
  connected,
}: {
  player: GameView['players'][number] | null;
  game: GameView;
  position: 'top' | 'left' | 'right';
  connected: Map<string, boolean>;
}) {
  if (!player) return <div className={`opponent opponent--${position} is-empty`} />;
  const isActive = game.currentPlayerId === player.id;
  const team = player.teamId === 'TEAM_A' ? 'A' : 'B';
  const isOnline = connected.get(player.id) ?? true;

  return (
    <div className={`opponent opponent--${position} ${isActive ? 'is-active' : ''}`}>
      <span className="opponent__name">{player.displayName}</span>
      <span className="opponent__meta">
        <span className={`pip pip--${team.toLowerCase()}`}>{team}</span>
        <span className="opponent__cards">{player.handCount} cards</span>
      </span>
      <span className="opponent__seat">{SEAT_LABEL[player.seat]}</span>
      {!isOnline && <span className="tag tag--warn">Disconnected</span>}
      {player.handType === 'BUCHAROO' && <span className="tag tag--good">On Bucharoo</span>}
      {isActive && <span className="opponent__turn" aria-label="Playing now" />}
    </div>
  );
}
