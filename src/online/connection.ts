import type { Appearance } from '../appearance';
import {
  SNAPSHOT_INTERVAL_TICKS,
  type ClientMessage,
  type MatchPlayer,
  type RoomPlayer,
  type RoomSettings,
  type RoomSummary,
  type ServerMessage,
} from '../net/protocol';
import { applySnapshot } from '../net/snapshot';
import { Game, TICK_RATE, type GameEvent } from '../sim/game';

const SNAPSHOT_MS = (SNAPSHOT_INTERVAL_TICKS / TICK_RATE) * 1000;
const PING_INTERVAL_MS = 2000;

export interface ConnectionEvents {
  onClose(wasOpen: boolean): void;
  onRooms(rooms: RoomSummary[]): void;
  onJoined(): void;
  onLeft(): void;
  onRoom(): void;
  onChat(from: string | null, text: string): void;
  onError(message: string): void;
  onMatchStart(): void;
  /** After a snapshot was applied; `events` happened since the previous one. */
  onState(events: GameEvent[]): void;
  onMatchEnd(): void;
}

/**
 * WebSocket link to the game server. Keeps the room info and, during a match, a local
 * mirror of the game that every snapshot overwrites, so the renderer can draw it as usual.
 */
export class Connection {
  myId = -1;
  roomName = '';
  players: RoomPlayer[] = [];
  running = false;
  settings: RoomSettings = { teamSize: 1, timeLimitSeconds: 240, bots: 0 };
  /** The match as last reported by the server (null outside a match). */
  mirror: Game | null = null;
  ping = 0;

  private readonly socket: WebSocket;
  private readonly pingTimer: number;
  private lastSnapshotAt = 0;
  private opened = false;

  constructor(
    appearance: Appearance,
    private readonly events: ConnectionEvents,
  ) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.socket.addEventListener('open', () => {
      this.opened = true;
      this.send({ t: 'hello', appearance });
    });
    this.socket.addEventListener('close', () => {
      clearInterval(this.pingTimer);
      this.events.onClose(this.opened);
    });
    this.socket.addEventListener('message', (e) => this.handle(JSON.parse(e.data as string) as ServerMessage));
    this.pingTimer = window.setInterval(() => this.send({ t: 'ping', time: performance.now() }), PING_INTERVAL_MS);
  }

  get me(): RoomPlayer | undefined {
    return this.players.find((p) => p.id === this.myId);
  }

  get inRoom(): boolean {
    return this.roomName !== '';
  }

  send(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close();
  }

  /** How far we are between the last two snapshots (0..1), for smooth drawing. */
  blend(now: number): number {
    return Math.max(0, Math.min(1, (now - this.lastSnapshotAt) / SNAPSHOT_MS));
  }

  private handle(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.myId = message.id;
        break;
      case 'rooms':
        this.events.onRooms(message.rooms);
        break;
      case 'joined':
        this.roomName = message.name;
        this.events.onJoined();
        break;
      case 'left':
        this.roomName = '';
        this.players = [];
        this.running = false;
        this.mirror = null;
        this.events.onLeft();
        break;
      case 'room':
        this.players = message.players;
        this.running = message.running;
        this.settings = message.settings;
        this.events.onRoom();
        break;
      case 'chat':
        this.events.onChat(message.from, message.text);
        break;
      case 'matchStart':
        this.mirror = createMirror(message.players, message.timeLimitSeconds);
        this.lastSnapshotAt = performance.now();
        this.events.onMatchStart();
        break;
      case 'state':
        if (!this.mirror) return;
        applySnapshot(this.mirror, message.s);
        this.lastSnapshotAt = performance.now();
        this.events.onState(message.events);
        break;
      case 'matchEnd':
        this.mirror = null;
        this.events.onMatchEnd();
        break;
      case 'error':
        this.events.onError(message.message);
        break;
      case 'pong':
        this.ping = Math.round(performance.now() - message.time);
        break;
    }
  }
}

/** Local copy of the match; its own seed and portal draw are never used, the server's state wins. */
function createMirror(players: MatchPlayer[], timeLimitSeconds: number): Game {
  return new Game(
    players.map(({ id, name, team, appearance }) => ({ id, name, team, appearance })),
    { seed: 1, timeLimitSeconds },
  );
}
