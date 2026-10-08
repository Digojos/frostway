import { randomAppearance, type Appearance } from '../src/appearance';
import { CONFIG } from '../src/config';
import {
  MAX_BOTS,
  MAX_PLAYERS_PER_ROOM,
  SNAPSHOT_INTERVAL_TICKS,
  TEAM_COUNT,
  teamName,
  TIME_LIMIT_OPTIONS,
  type MatchPlayer,
  type RoomPlayer,
  type RoomSettings,
  type RoomSummary,
  type ServerMessage,
} from '../src/net/protocol';
import { buildSnapshot } from '../src/net/snapshot';
import { Bot } from '../src/sim/bot';
import { Game, TICK_RATE, type GameEvent } from '../src/sim/game';
import { SPELL_ORDER, type SpellId } from '../src/sim/spells';

/** How long the result stays on screen before everyone goes back to the room. */
const RESULT_TICKS = 8 * TICK_RATE;
const BOT_NAMES = ['Bot Gelo', 'Bot Neve', 'Bot Cristal'];
/** Bot ids stay far from client ids. */
const BOT_ID_BASE = 1_000_000;

export interface Client {
  readonly id: number;
  appearance: Appearance;
  room: Room | null;
  send(message: ServerMessage): void;
  sendRaw(json: string): void;
}

export class Room {
  readonly clients = new Map<number, Client>();
  private readonly teams = new Map<number, number | null>();
  private adminId: number | null = null;
  private settings: RoomSettings = { teamSize: 1, timeLimitSeconds: CONFIG.match.timeLimitSeconds, bots: 0 };
  private game: Game | null = null;
  private bots: Bot[] = [];
  private pendingEvents: GameEvent[] = [];
  private ticksSinceSnapshot = 0;
  private endTicks = 0;

  constructor(
    readonly id: string,
    readonly name: string,
  ) {}

  get summary(): RoomSummary {
    return {
      id: this.id,
      name: this.name,
      players: this.clients.size,
      maxPlayers: MAX_PLAYERS_PER_ROOM,
      running: this.game !== null,
    };
  }

  get isFull(): boolean {
    return this.clients.size >= MAX_PLAYERS_PER_ROOM;
  }

  join(client: Client): void {
    client.room = this;
    this.clients.set(client.id, client);
    this.teams.set(client.id, null);
    this.adminId ??= client.id;
    client.send({ t: 'joined', roomId: this.id, name: this.name });
    this.broadcastRoom();
    this.systemChat(`${client.appearance.name} entrou na sala`);
    // Joining mid-match: watch as a spectator.
    if (this.game) client.send({ t: 'matchStart', players: this.matchPlayers(), timeLimitSeconds: this.settings.timeLimitSeconds });
  }

  leave(client: Client): void {
    if (!this.clients.delete(client.id)) return;
    client.room = null;
    this.teams.delete(client.id);
    this.game?.removePlayer(client.id);
    if (this.adminId === client.id) {
      this.adminId = this.clients.keys().next().value ?? null;
      const admin = this.adminId === null ? undefined : this.clients.get(this.adminId);
      if (admin) this.systemChat(`${admin.appearance.name} agora é o admin`);
    }
    client.send({ t: 'left' });
    this.broadcastRoom();
    this.systemChat(`${client.appearance.name} saiu da sala`);
  }

  setTeam(by: Client, playerId: number, team: number | null): void {
    const target = this.clients.get(playerId);
    if (!target) return;
    if (by.id !== playerId && by.id !== this.adminId) return by.send({ t: 'error', message: 'Só o admin pode mover outros jogadores' });
    if (this.game) return by.send({ t: 'error', message: 'Espere a partida acabar para trocar de time' });
    if (team !== null && (!Number.isInteger(team) || team < 1 || team > TEAM_COUNT)) return;
    if (this.teams.get(playerId) === team) return;
    if (team !== null && this.teamMembers(team).length >= this.settings.teamSize) {
      return by.send({ t: 'error', message: `O time ${teamName(team)} está cheio` });
    }
    this.teams.set(playerId, team);
    this.broadcastRoom();
  }

  updateSettings(by: Client, settings: RoomSettings): void {
    if (!this.requireAdmin(by)) return;
    const teamSize = [1, 2, 3].includes(settings.teamSize) ? settings.teamSize : this.settings.teamSize;
    this.settings = {
      teamSize,
      timeLimitSeconds: TIME_LIMIT_OPTIONS.includes(settings.timeLimitSeconds)
        ? settings.timeLimitSeconds
        : this.settings.timeLimitSeconds,
      bots: Math.max(0, Math.min(MAX_BOTS, Math.round(Number(settings.bots) || 0))),
    };
    // Shrinking teams: whoever no longer fits goes to the spectators.
    for (let team = 1; team <= TEAM_COUNT; team++) {
      for (const id of this.teamMembers(team).slice(teamSize)) this.teams.set(id, null);
    }
    this.broadcastRoom();
  }

  start(by: Client): void {
    if (!this.requireAdmin(by) || this.game) return;
    const humans = [...this.clients.values()].filter((c) => this.teams.get(c.id));
    if (humans.length === 0) return by.send({ t: 'error', message: 'Entre num time antes de começar' });

    const usedTeams = new Set(humans.map((c) => this.teams.get(c.id)!));
    const players: MatchPlayer[] = humans.map((c) => ({
      id: c.id,
      name: c.appearance.name,
      team: this.teams.get(c.id)!,
      appearance: c.appearance,
    }));
    // Bots each get a team of their own, numbered after the human teams.
    for (let i = 0; i < this.settings.bots; i++) {
      const team = Math.max(TEAM_COUNT, ...usedTeams) + 1 + i;
      const name = BOT_NAMES[i % BOT_NAMES.length];
      players.push({ id: BOT_ID_BASE + i, name, team, appearance: randomAppearance(name) });
    }

    this.game = new Game(players, {
      seed: (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0,
      timeLimitSeconds: this.settings.timeLimitSeconds,
    });
    this.bots = players.filter((p) => p.id >= BOT_ID_BASE).map((p) => new Bot(p.id, p.id + Date.now()));
    this.pendingEvents = [];
    this.endTicks = 0;
    this.broadcast({ t: 'matchStart', players, timeLimitSeconds: this.settings.timeLimitSeconds });
    this.broadcastRoom();
    this.systemChat('Partida iniciada!');
  }

  stop(by: Client | null): void {
    if ((by && !this.requireAdmin(by)) || !this.game) return;
    this.game = null;
    this.bots = [];
    this.broadcast({ t: 'matchEnd' });
    this.broadcastRoom();
    if (by) this.systemChat(`Partida encerrada por ${by.appearance.name}`);
  }

  chat(from: Client, text: string): void {
    this.broadcast({ t: 'chat', from: from.appearance.name, text });
  }

  move(client: Client, x: number, y: number): void {
    if (Number.isFinite(x) && Number.isFinite(y)) this.game?.moveTo(client.id, x, y);
  }

  cast(client: Client, spell: SpellId, x: number, y: number): void {
    if (SPELL_ORDER.includes(spell) && Number.isFinite(x) && Number.isFinite(y)) this.game?.cast(client.id, spell, x, y);
  }

  tick(): void {
    const game = this.game;
    if (!game) return;

    for (const bot of this.bots) bot.think(game);
    game.step();
    for (const event of game.events) {
      for (const bot of this.bots) bot.onEvent(event);
      this.pendingEvents.push(event);
    }
    game.events = [];

    // Events ride along with the next snapshot (at most ~50 ms later).
    if (++this.ticksSinceSnapshot >= SNAPSHOT_INTERVAL_TICKS) {
      this.ticksSinceSnapshot = 0;
      this.sendState(game);
    }

    if (game.status !== 'running' && ++this.endTicks >= RESULT_TICKS) {
      const winner = game.players.find((p) => p.team === game.winnerTeam);
      this.systemChat(game.status === 'timeout' ? 'Tempo esgotado!' : `${winner ? teamName(winner.team) : 'Um time'} venceu!`);
      this.stop(null);
    }
  }

  private sendState(game: Game): void {
    const json = JSON.stringify({ t: 'state', s: buildSnapshot(game), events: this.pendingEvents });
    this.pendingEvents = [];
    for (const client of this.clients.values()) client.sendRaw(json);
  }

  private matchPlayers(): MatchPlayer[] {
    return (this.game?.players ?? []).map((p) => ({ id: p.id, name: p.name, team: p.team, appearance: p.appearance }));
  }

  private teamMembers(team: number): number[] {
    return [...this.teams].filter(([, t]) => t === team).map(([id]) => id);
  }

  private requireAdmin(client: Client): boolean {
    if (client.id === this.adminId) return true;
    client.send({ t: 'error', message: 'Só o admin pode fazer isso' });
    return false;
  }

  private broadcastRoom(): void {
    const players: RoomPlayer[] = [...this.clients.values()].map((c) => ({
      id: c.id,
      name: c.appearance.name,
      team: this.teams.get(c.id) ?? null,
      admin: c.id === this.adminId,
      appearance: c.appearance,
    }));
    this.broadcast({ t: 'room', players, running: this.game !== null, settings: this.settings });
  }

  private systemChat(text: string): void {
    this.broadcast({ t: 'chat', from: null, text });
  }

  private broadcast(message: ServerMessage): void {
    const json = JSON.stringify(message);
    for (const client of this.clients.values()) client.sendRaw(json);
  }
}
