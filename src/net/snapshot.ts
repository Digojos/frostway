import type { Game, GameStatus } from '../sim/game';
import type { Mark, Projectile, Smoke } from '../sim/spells';
import { SPELL_ORDER } from '../sim/spells';

/** Everything a client needs to draw one moment of a match. Never includes the correct portal. */
export interface Snapshot {
  tick: number;
  status: GameStatus;
  winnerTeam: number | null;
  players: PlayerSnap[];
  projectiles: ProjectileSnap[];
  smokes: Smoke[];
  /** Per phase. */
  spikes: { id: number; x: number; y: number; radius: number; age: number }[][];
  bananas: { id: number; zone: number; along: number; side: -1 | 1; age: number }[][];
}

export interface PlayerSnap {
  id: number;
  phase: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  hp: number;
  alive: boolean;
  respawnTicks: number;
  invulnTicks: number;
  slow: number;
  slowTicks: number;
  rootTicks: number;
  blindTicks: number;
  /** Who is hooking this player, if anyone. */
  pullCaster: number | null;
  mark: Mark | null;
  /** Being shoved (affects animation and footsteps). */
  shoved: boolean;
  /** Ticks left per spell, in SPELL_ORDER. */
  cooldowns: number[];
  finishTick: number | null;
}

type ProjectileSnap = Pick<Projectile, 'id' | 'kind' | 'ownerId' | 'phase' | 'x' | 'y' | 'vx' | 'vy' | 'radius'>;

const r = (n: number) => Math.round(n * 10) / 10;

export function buildSnapshot(game: Game): Snapshot {
  return {
    tick: game.tick,
    status: game.status,
    winnerTeam: game.winnerTeam,
    players: game.players.map((p) => ({
      id: p.id,
      phase: p.phase,
      x: r(p.x),
      y: r(p.y),
      vx: r(p.vx),
      vy: r(p.vy),
      tx: r(p.tx),
      ty: r(p.ty),
      hp: p.hp,
      alive: p.alive,
      respawnTicks: p.respawnTicks,
      invulnTicks: p.invulnTicks,
      slow: p.slow,
      slowTicks: p.slowTicks,
      rootTicks: p.rootTicks,
      blindTicks: p.blindTicks,
      pullCaster: p.pull?.casterId ?? null,
      mark: p.mark && { ...p.mark, x: r(p.mark.x), y: r(p.mark.y) },
      shoved: p.kbx !== 0 || p.kby !== 0,
      cooldowns: SPELL_ORDER.map((spell) => p.cooldowns[spell]),
      finishTick: p.finishTick,
    })),
    projectiles: game.projectiles.map((proj) => ({
      id: proj.id,
      kind: proj.kind,
      ownerId: proj.ownerId,
      phase: proj.phase,
      x: r(proj.x),
      y: r(proj.y),
      vx: r(proj.vx),
      vy: r(proj.vy),
      radius: proj.radius,
    })),
    smokes: game.smokes,
    spikes: game.hazards.map((field) => field.spikes.map(({ id, x, y, radius, age }) => ({ id, x: r(x), y: r(y), radius, age }))),
    bananas: game.hazards.map((field) => field.bananas.map(({ id, zone, along, side, age }) => ({ id, zone, along: r(along), side, age }))),
  };
}

/**
 * Copies a snapshot into a local mirror of the game so the renderer can draw it as usual.
 * The previous position of everything goes into px/py, so drawing can blend between the
 * last two snapshots.
 */
export function applySnapshot(game: Game, snap: Snapshot): void {
  game.tick = snap.tick;
  game.status = snap.status;
  game.winnerTeam = snap.winnerTeam;

  for (const s of snap.players) {
    const p = game.player(s.id);
    if (!p) continue;
    const teleported = Math.hypot(s.x - p.x, s.y - p.y) > 60 || s.phase !== p.phase;
    p.px = teleported ? s.x : p.x;
    p.py = teleported ? s.y : p.y;
    Object.assign(p, {
      phase: s.phase,
      x: s.x,
      y: s.y,
      vx: s.vx,
      vy: s.vy,
      tx: s.tx,
      ty: s.ty,
      hp: s.hp,
      alive: s.alive,
      respawnTicks: s.respawnTicks,
      invulnTicks: s.invulnTicks,
      slow: s.slow,
      slowTicks: s.slowTicks,
      rootTicks: s.rootTicks,
      blindTicks: s.blindTicks,
      pull: s.pullCaster === null ? null : { casterId: s.pullCaster, ticks: 1 },
      mark: s.mark,
      kbx: s.shoved ? 1 : 0,
      kby: 0,
      finishTick: s.finishTick,
    });
    SPELL_ORDER.forEach((spell, i) => (p.cooldowns[spell] = s.cooldowns[i]));
  }

  const previous = new Map(game.projectiles.map((proj) => [proj.id, proj]));
  game.projectiles = snap.projectiles.map((s) => {
    const before = previous.get(s.id);
    return { ...s, px: before?.x ?? s.x, py: before?.y ?? s.y, traveled: 0, range: 0 };
  });
  game.smokes = snap.smokes;
  game.hazards.forEach((field, phase) => {
    field.spikes = (snap.spikes[phase] ?? []).map((s) => ({ ...s, hits: new Set<number>() }));
    field.bananas = (snap.bananas[phase] ?? []).map((b) => ({ ...b, hits: new Set<number>() }));
  });
}
