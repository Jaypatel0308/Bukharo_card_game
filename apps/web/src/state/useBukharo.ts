import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  GameActionPayload,
  RoomView,
  Seat,
  ServerError,
  TeamId,
  ServerMessage,
  WildAssignment,
} from '@bukharo/shared';

import {
  Connection,
  clearSessionToken,
  loadSessionToken,
  newActionId,
  saveSessionToken,
  type ConnectionStatus,
} from '../net/connection';
import { playSound } from '../sound';

export interface Toast {
  id: string;
  message: string;
  tone: 'error' | 'info';
}

/** The wild-card chooser opens when the server needs an interpretation (§43). */
export interface PendingWildChoice {
  options: WildAssignment[][];
  retry: (assignments: WildAssignment[]) => void;
}

export interface Bukharo {
  status: ConnectionStatus;
  room: RoomView | null;
  toasts: Toast[];
  dismissToast(id: string): void;
  pendingWild: PendingWildChoice | null;
  cancelWildChoice(): void;

  createRoom(displayName: string, targetScore: number): void;
  joinRoom(displayName: string, roomCode: string): void;
  leaveRoom(): void;
  setReady(ready: boolean): void;
  chooseSeat(seat: Seat): void;
  assignSeat(playerId: string, seat: Seat): void;
  kickPlayer(playerId: string): void;
  setTargetScore(targetScore: number): void;
  setTeamName(teamId: TeamId, name: string): void;
  startGame(): void;
  nextRound(): void;
  restartMatch(): void;
  act(action: GameActionPayload): void;
}

export function useBukharo(): Bukharo {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [room, setRoom] = useState<RoomView | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingWild, setPendingWild] = useState<PendingWildChoice | null>(null);

  const connectionRef = useRef<Connection | null>(null);
  /** actionId → the action, so an AMBIGUOUS_WILD reply can be retried. */
  const inFlight = useRef(new Map<string, GameActionPayload>());
  const previousTurn = useRef<string | null>(null);

  const pushToast = useCallback((message: string, tone: Toast['tone'] = 'error') => {
    const toast: Toast = { id: newActionId(), message, tone };
    setToasts((current) => [...current.slice(-2), toast]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== toast.id));
    }, 6000);
  }, []);

  const handleError = useCallback(
    (error: ServerError) => {
      if (error.code === 'AMBIGUOUS_WILD' && error.actionId && error.options?.length) {
        const original = inFlight.current.get(error.actionId);
        if (original) {
          setPendingWild({
            options: error.options,
            retry: (assignments) => {
              setPendingWild(null);
              const actionId = newActionId();
              const payload = { ...original, wildAssignments: assignments };
              inFlight.current.set(actionId, payload);
              connectionRef.current?.send({ type: 'game:action', actionId, action: payload });
            },
          });
          return;
        }
      }
      if (error.code === 'SESSION_INVALID') {
        // This comes from the automatic resume on connect, not from anything
        // the player did — drop the stale token quietly.
        clearSessionToken();
        return;
      }
      pushToast(error.message);
      playSound('error');
    },
    [pushToast],
  );

  useEffect(() => {
    const connection = new Connection({
      onStatus: setStatus,
      onMessage: (message: ServerMessage) => {
        switch (message.type) {
          case 'session':
            saveSessionToken(message.sessionToken);
            window.history.replaceState(null, '', `/room/${message.roomCode}`);
            break;
          case 'room:state':
            setRoom(message.room);
            break;
          case 'game:event':
            handleGameEvent(message.event.type);
            break;
          case 'error':
            handleError(message.error);
            break;
          case 'left':
            clearSessionToken();
            setRoom(null);
            window.history.replaceState(null, '', '/');
            break;
          default:
            break;
        }
      },
    });
    connectionRef.current = connection;
    connection.connect();
    return () => connection.close();
  }, [handleError]);

  // A gentle nudge when the turn comes round (§71).
  useEffect(() => {
    const currentId = room?.game?.currentPlayerId ?? null;
    if (currentId && currentId !== previousTurn.current && currentId === room?.youId) {
      playSound('yourTurn');
    }
    previousTurn.current = currentId;
  }, [room?.game?.currentPlayerId, room?.youId]);

  const send = useCallback((message: Parameters<Connection['send']>[0]) => {
    connectionRef.current?.send(message);
  }, []);

  const act = useCallback(
    (action: GameActionPayload) => {
      const actionId = newActionId();
      inFlight.current.set(actionId, action);
      if (inFlight.current.size > 40) {
        inFlight.current.delete(inFlight.current.keys().next().value as string);
      }
      send({ type: 'game:action', actionId, action });
    },
    [send],
  );

  return useMemo<Bukharo>(
    () => ({
      status,
      room,
      toasts,
      dismissToast: (id) => setToasts((current) => current.filter((t) => t.id !== id)),
      pendingWild,
      cancelWildChoice: () => setPendingWild(null),

      createRoom: (displayName, targetScore) =>
        send({ type: 'room:create', actionId: newActionId(), displayName, targetScore }),
      joinRoom: (displayName, roomCode) =>
        send({ type: 'room:join', actionId: newActionId(), displayName, roomCode: roomCode.toUpperCase() }),
      leaveRoom: () => {
        send({ type: 'room:leave' });
        clearSessionToken();
      },
      setReady: (ready) => send({ type: 'player:ready', ready }),
      chooseSeat: (seat) => send({ type: 'seat:choose', seat }),
      assignSeat: (playerId, seat) => send({ type: 'host:assignSeat', playerId, seat }),
      kickPlayer: (playerId) => send({ type: 'host:kick', playerId }),
      setTargetScore: (targetScore) => send({ type: 'host:settings', targetScore }),
      setTeamName: (teamId, name) => send({ type: 'host:teamName', teamId, name }),
      startGame: () => send({ type: 'game:start', actionId: newActionId() }),
      nextRound: () => send({ type: 'round:next', actionId: newActionId() }),
      restartMatch: () => send({ type: 'match:restart', actionId: newActionId() }),
      act,
    }),
    [status, room, toasts, pendingWild, send, act],
  );
}

function handleGameEvent(type: string): void {
  switch (type) {
    case 'CARD_DRAWN':
    case 'DISCARD_PILE_TAKEN':
      playSound('draw');
      break;
    case 'CARD_DISCARDED':
      playSound('discard');
      break;
    case 'MELD_CREATED':
    case 'MELD_UPDATED':
      playSound('meld');
      break;
    case 'BUCHARO_COMPLETED':
    case 'BUCHAROO_TAKEN':
      playSound('bucharo');
      break;
    case 'PLAYER_WENT_OUT':
      playSound('wentOut');
      break;
    default:
      break;
  }
}

/** Reads a room code out of /room/CODE or /join/CODE for invite links (§64). */
export function roomCodeFromUrl(): string {
  const match = window.location.pathname.match(/^\/(?:join|room)\/([A-Za-z0-9]{4,8})$/);
  return match ? match[1]!.toUpperCase() : '';
}

export { loadSessionToken };
