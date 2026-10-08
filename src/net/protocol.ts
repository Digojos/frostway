import type { Appearance } from '../appearance';
import type { GameEvent } from '../sim/game';
import type { SpellId } from '../sim/spells';
import type { Snapshot } from './snapshot';

export const TEAM_COUNT = 4;
/** Team numbers start at 1. */
export const TEAM_NAMES = ['Azul', 'Vermelho', 'Verde', 'Amarelo'];
export const TEAM_COLORS = ['#4a8df0', '#e0524a', '#4fb35e', '#e8c13a'];
export const teamName = (team: number): string => TEAM_NAMES[team - 1] ?? `Time ${team}`;

export const MAX_PLAYERS_PER_ROOM = 12;
export const MAX_ROOM_NAME_LENGTH = 40;
export const MAX_CHAT_LENGTH = 140;
export const MAX_BOTS = 3;
export const TIME_LIMIT_OPTIONS = [180, 300, 600, 1200];
/** A snapshot goes out every this many simulation ticks (60 / 3 = 20 per second). */
export const SNAPSHOT_INTERVAL_TICKS = 3;

export interface RoomSummary {
  id: string;
  name: string;
  players: number;
  maxPlayers: number;
  running: boolean;
}

export interface RoomPlayer {
  id: number;
  name: string;
  /** null = spectator. */
  team: number | null;
  admin: boolean;
  appearance: Appearance;
}

export interface RoomSettings {
  teamSize: 1 | 2 | 3;
  timeLimitSeconds: number;
  /** Bots added at start, each on its own team. */
  bots: number;
}

/** Someone taking part in a match (humans and bots). */
export interface MatchPlayer {
  id: number;
  name: string;
  team: number;
  appearance: Appearance;
}

export type ClientMessage =
  | { t: 'hello'; appearance: Appearance }
  | { t: 'listRooms' }
  | { t: 'createRoom'; name: string }
  | { t: 'joinRoom'; roomId: string }
  | { t: 'leaveRoom' }
  /** `team` null = spectators. Players move themselves; the admin can move anyone. */
  | { t: 'setTeam'; playerId: number; team: number | null }
  | { t: 'settings'; settings: RoomSettings }
  | { t: 'start' }
  | { t: 'stop' }
  | { t: 'chat'; text: string }
  | { t: 'move'; x: number; y: number }
  | { t: 'cast'; spell: SpellId; x: number; y: number }
  | { t: 'ping'; time: number };

export type ServerMessage =
  | { t: 'welcome'; id: number }
  | { t: 'rooms'; rooms: RoomSummary[] }
  | { t: 'joined'; roomId: string; name: string }
  | { t: 'left' }
  | { t: 'room'; players: RoomPlayer[]; running: boolean; settings: RoomSettings }
  | { t: 'chat'; from: string | null; text: string }
  | { t: 'matchStart'; players: MatchPlayer[]; timeLimitSeconds: number }
  /** Current state plus everything that happened since the previous one. */
  | { t: 'state'; s: Snapshot; events: GameEvent[] }
  | { t: 'matchEnd' }
  | { t: 'error'; message: string }
  | { t: 'pong'; time: number };
