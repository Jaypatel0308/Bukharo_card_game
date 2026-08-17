import { useMemo, useState } from 'react';
import { validateMeld, validateOpeningRun } from '@bukharo/game-engine';
import type { Card, GameView, Seat, TeamId } from '@bukharo/game-engine';

import { ActionBar } from '../components/ActionBar';
import { DiscardPileView } from '../components/DiscardPileView';
import { GameLog } from '../components/GameLog';
import { Hand } from '../components/Hand';
import { Melds } from '../components/Melds';
import { OpponentSeat } from '../components/OpponentSeat';
import { RoundSummary } from '../components/RoundSummary';
import { Scoreboard } from '../components/Scoreboard';
import { StalledTurn } from '../components/StalledTurn';
import { TableCentre } from '../components/TableCentre';
import { TopBar } from '../components/TopBar';
import { WildChooser } from '../components/WildChooser';
import type { Bukharo } from '../state/useBukharo';
import { isMuted, setMuted } from '../sound';

const CLOCKWISE: Seat[] = ['NORTH', 'EAST', 'SOUTH', 'WEST'];

/** Rotates the table so the viewer is always at the bottom (§36). */
function arrange(game: GameView, youSeat: Seat | null) {
  const start = CLOCKWISE.indexOf(youSeat ?? 'NORTH');
  const seatAt = (offset: number): Seat => CLOCKWISE[(start + offset) % 4]!;
  const find = (seat: Seat) => game.players.find((p) => p.seat === seat) ?? null;
  return { left: find(seatAt(1)), top: find(seatAt(2)), right: find(seatAt(3)) };
}

type Drawer = 'none' | 'score' | 'log' | 'discard';

export function Table({ app }: { app: Bukharo }) {
  const room = app.room!;
  const game = room.game!;
  const you = game.you;
  const teamNames = room.teamNames;

  const [selected, setSelected] = useState<string[]>([]);
  const [targetMeldId, setTargetMeldId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<Drawer>('none');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [muted, setMutedState] = useState(isMuted);

  const isYourTurn = you !== null && game.currentPlayerId === you.id;
  const phase = game.turnPhase;
  const teamOpened = you ? game.teams[you.teamId].isOpened : false;
  const minimumMeld = teamOpened ? room.rules.normalMeldMinimum : room.rules.openingRunMinimum;
  const seats = useMemo(() => arrange(game, you?.seat ?? null), [game, you?.seat]);

  // Your team sits on your side of the table, the opponents across from you.
  // A spectator has no side, so Team A is treated as the near one.
  const yourTeam: TeamId = you?.teamId ?? 'TEAM_A';
  const theirTeam: TeamId = yourTeam === 'TEAM_A' ? 'TEAM_B' : 'TEAM_A';

  const isHost = room.players.find((p) => p.id === room.youId)?.isHost ?? false;
  const activePlayer = game.players.find((p) => p.id === game.currentPlayerId);
  const connectedById = new Map(room.players.map((p) => [p.id, p.connected]));
  const waitingFor = room.waitingForPlayerId
    ? room.players.find((p) => p.id === room.waitingForPlayerId)
    : null;

  const clearSelection = (): void => {
    setSelected([]);
    setTargetMeldId(null);
  };

  const submit = (payload: Parameters<Bukharo['act']>[0]): void => {
    app.act(payload);
    clearSelection();
  };

  const canDraw = isYourTurn && phase === 'AWAITING_DRAW';
  const canPlay = isYourTurn && (phase === 'PLAYING_CARDS' || phase === 'AWAITING_DISCARD');
  const canSelectForMeld = canPlay && phase === 'PLAYING_CARDS';

  const selectedCards = useMemo(
    () => selected.map((id) => you?.hand.find((c) => c.id === id)).filter((c): c is Card => Boolean(c)),
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

  const renderMelds = (teamId: TeamId) => (
    <div className="meldArea">
      <Melds
        melds={game.melds}
        teamId={teamId}
        title={teamNames[teamId]}
        isOpened={game.teams[teamId].isOpened}
        wildRank={game.wildRank}
        openingRunMinimum={room.rules.openingRunMinimum}
        isYours={teamId === you?.teamId}
        canAdd={canSelectForMeld && you?.teamId === teamId}
        selectableMeldId={targetMeldId}
        onSelectMeld={(id) => setTargetMeldId((current) => (current === id ? null : id))}
      />
    </div>
  );

  return (
    <main className="screen screen--table">
      <TopBar
        game={game}
        teamNames={teamNames}
        muted={muted}
        onToggleMute={() => {
          const next = !muted;
          setMuted(next);
          setMutedState(next);
        }}
        onOpenScores={() => setDrawer('score')}
        onOpenLog={() => setDrawer('log')}
        onLeave={() => setConfirmLeave(true)}
      />

      <p className={`turnbar ${isYourTurn ? 'is-yours' : ''}`} role="status" aria-live="polite">
        {turnMessage()}
      </p>

      {waitingFor && room.status === 'PLAYING' && (
        <StalledTurn
          playerName={waitingFor.displayName}
          waitingSince={room.waitingSince}
          graceMs={room.disconnectGraceMs}
          isHost={isHost}
          onSkip={app.skipAbsentPlayer}
          onEndMatch={app.endMatch}
        />
      )}

      {renderMelds(theirTeam)}

      <div className="table">
        <OpponentSeat
          player={seats.top}
          game={game}
          position="top"
          teamNames={teamNames}
          connected={seats.top ? (connectedById.get(seats.top.id) ?? true) : true}
        />
        <div className="table__middle">
          <OpponentSeat
            player={seats.left}
            game={game}
            position="left"
            teamNames={teamNames}
            connected={seats.left ? (connectedById.get(seats.left.id) ?? true) : true}
          />
          <TableCentre game={game} onInspectDiscard={() => setDrawer('discard')} />
          <OpponentSeat
            player={seats.right}
            game={game}
            position="right"
            teamNames={teamNames}
            connected={seats.right ? (connectedById.get(seats.right.id) ?? true) : true}
          />
        </div>
      </div>

      {renderMelds(yourTeam)}

      {you && (
        <Hand
          cards={you.hand}
          wildRank={game.wildRank}
          selectedIds={selected}
          disabled={!isYourTurn}
          onToggle={(cardId) =>
            setSelected((current) =>
              current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId],
            )
          }
        />
      )}

      <ActionBar
        discardCount={game.discardPile.length}
        meldLabel={teamOpened ? 'Create meld' : `Open with ${minimumMeld}+`}
        meldLabelShort={teamOpened ? 'Meld' : `Open ${minimumMeld}+`}
        canDraw={canDraw}
        canMeld={meldPreview?.ok === true}
        canAddToMeld={addPreview?.ok === true}
        canDiscard={canPlay && selected.length === 1}
        hasSelection={selected.length > 0 || targetMeldId !== null}
        onDraw={() => submit({ type: 'DRAW_STOCK' })}
        onTakePile={() => submit({ type: 'TAKE_DISCARD_PILE' })}
        onSeePile={() => setDrawer('discard')}
        onMeld={() => submit({ type: 'CREATE_MELD', cardIds: selected })}
        onAddToMeld={() => submit({ type: 'ADD_TO_MELD', meldId: targetMeldId!, cardIds: selected })}
        onDiscard={() => submit({ type: 'DISCARD', cardId: selected[0]! })}
        onClear={clearSelection}
      />

      {canDraw && (
        <p className="hint hint--floating">Start your turn by drawing a card or taking the discard pile.</p>
      )}
      {canSelectForMeld && !teamOpened && (
        <p className="hint hint--floating">
          Your team is not open yet. Play a clean run of {room.rules.openingRunMinimum}+ cards in one suit —
          no wilds — before anything else.
        </p>
      )}
      {meldProblem && <p className="hint hint--floating hint--problem">{meldProblem}</p>}
      {addProblem && <p className="hint hint--floating hint--problem">{addProblem}</p>}

      {drawer === 'discard' && (
        <DiscardPileView
          cards={game.discardPile}
          wildRank={game.wildRank}
          onTake={
            canDraw
              ? () => {
                  setDrawer('none');
                  submit({ type: 'TAKE_DISCARD_PILE' });
                }
              : null
          }
          onClose={() => setDrawer('none')}
        />
      )}
      {drawer === 'score' && (
        <Scoreboard game={game} teamNames={teamNames} onClose={() => setDrawer('none')} />
      )}
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
