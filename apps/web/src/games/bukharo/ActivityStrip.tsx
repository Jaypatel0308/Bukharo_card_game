import type { GameView } from '@bukharo/game-engine';

interface Props {
  game: GameView;
  /** Names of players who are currently away, so waiting reads correctly. */
  disconnected: Set<string>;
}

/**
 * A line of commentary: what the player on turn is doing at this moment, and
 * the last thing that actually happened.
 *
 * Between turns there is otherwise nothing to look at — the log is behind a
 * button, and the turn bar only says whose turn it is, never what they are up
 * to. This is the difference between waiting and watching.
 */
export function ActivityStrip({ game, disconnected }: Props) {
  const current = game.players.find((p) => p.id === game.currentPlayerId);
  const isYou = game.you && current?.id === game.you.id;
  const name = isYou ? 'You' : (current?.displayName ?? 'Someone');
  const last = game.log[game.log.length - 1];

  return (
    <div className="activity" role="status" aria-live="polite">
      <span className="activity__now">{doingNow(name, Boolean(isYou), game, disconnected, current?.id)}</span>
      {last && <span className="activity__last">{last.message}</span>}
    </div>
  );
}

function doingNow(
  name: string,
  isYou: boolean,
  game: GameView,
  disconnected: Set<string>,
  currentId: string | undefined,
): string {
  if (currentId && disconnected.has(currentId)) {
    return `${name} ${isYou ? 'are' : 'is'} disconnected`;
  }

  switch (game.turnPhase) {
    case 'AWAITING_DRAW':
      return isYou
        ? 'You are choosing where to draw from'
        : `${name} is choosing the stock or the pile`;
    case 'PLAYING_CARDS':
      return isYou ? 'You are laying cards down' : `${name} is looking at their hand`;
    case 'AWAITING_DISCARD':
      return isYou ? 'You are picking a card to throw' : `${name} is picking a discard`;
    default:
      return isYou ? 'Your turn is over' : `${name} has finished`;
  }
}
