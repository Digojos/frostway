import type { Appearance } from '../appearance';
import { CONFIG } from '../config';
import { clampToCourse, dungeon, phaseOne, phaseTwo, PORTAL_RADIUS, type Course } from './course';
import { HazardField, type HazardHit } from './hazards';
import { Rng } from './rng';
import {
  emptyCooldowns,
  isProjectile,
  SPELLS,
  type Mark,
  type Projectile,
  type ProjectileKind,
  type Smoke,
  type SpellId,
} from './spells';
import { seconds, TICK_RATE } from './time';

export { TICK_RATE };

export const PLAYER = {
  radius: 14,
  /** World units per tick. */
  speed: CONFIG.player.speed / TICK_RATE,
  maxHp: CONFIG.player.maxHp,
  respawnTicks: seconds(CONFIG.player.respawnSeconds),
  respawnInvulnTicks: seconds(CONFIG.player.respawnInvulnSeconds),
  hitInvulnTicks: seconds(CONFIG.player.hitInvulnSeconds),
};

/** Phase index of the dungeon behind the correct portal. */
export const DUNGEON_PHASE = 2;

const PORTAL_ENTER_DISTANCE = PORTAL_RADIUS * 0.7;
/** Knockback speed is multiplied by this every tick, so the shove eases out. */
const KNOCKBACK_DECAY = 0.82;
/** How close to the cursor someone must be to be picked as the heal target. */
const HEAL_PICK_RADIUS = 40;
/** Hooked players end up this far in front of whoever hooked them. */
const HOOK_STOP_DISTANCE = PLAYER.radius * 2 + 6;
/** Safety limit on how long a pull can last. */
const MAX_PULL_TICKS = seconds(1.5);
const KILL_CREDIT_TICKS = seconds(CONFIG.killFeed.creditSeconds);
const START_OFFSETS = [
  [0, 0],
  [0, -36],
  [0, 36],
  [-36, 0],
  [-36, -36],
  [-36, 36],
];

export type DamageSource = HazardHit['source'] | 'fire' | 'gust';

export interface PlayerConfig {
  id: number;
  name: string;
  team: number;
  /** Cosmetic only; the simulation never reads it. */
  appearance: Appearance;
}

export interface Player extends PlayerConfig {
  /** Spawn slot, so players starting together don't stack on the same spot. */
  slot: number;
  /** Index into `Game.courses`. */
  phase: number;
  x: number;
  y: number;
  /** Position before the last step, for render interpolation. */
  px: number;
  py: number;
  vx: number;
  vy: number;
  /** Click-to-move destination. */
  tx: number;
  ty: number;
  hp: number;
  alive: boolean;
  respawnTicks: number;
  invulnTicks: number;
  cooldowns: Record<SpellId, number>;
  /** Fraction of speed lost while `slowTicks` > 0. */
  slow: number;
  slowTicks: number;
  /** Can't walk (hook). Spells still work. */
  rootTicks: number;
  /** Can't see (smoke). Only matters for the screen of that player. */
  blindTicks: number;
  /** Being dragged by a hook toward `casterId`. */
  pull: { casterId: number; ticks: number } | null;
  mark: Mark | null;
  /** Last player who hit this one with a spell, for kill credit. */
  lastAttacker: { id: number; tick: number } | null;
  /** Knockback velocity, decays every tick. */
  kbx: number;
  kby: number;
  /** Tick at which the player reached the dungeon. */
  finishTick: number | null;
}

export type GameStatus = 'running' | 'finished' | 'timeout';

export type GameEvent =
  | { type: 'hit'; playerId: number; damage: number; source: DamageSource }
  /** `killerId` = the player credited with the kill, or null if the course alone did it. */
  | { type: 'death'; playerId: number; killerId: number | null; phase: number; x: number; y: number }
  | { type: 'respawn'; playerId: number }
  | { type: 'phase'; playerId: number; phase: number }
  | { type: 'wrongPortal'; playerId: number }
  | { type: 'finish'; playerId: number }
  | { type: 'cast'; playerId: number; spell: SpellId }
  | { type: 'spellHit'; playerId: number; casterId: number; spell: ProjectileKind }
  | { type: 'heal'; playerId: number; casterId: number; amount: number }
  | { type: 'smoke'; phase: number; x: number; y: number }
  | { type: 'recall'; playerId: number; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'status'; status: GameStatus };

export interface GameOptions {
  seed: number;
  /** Shared clock for both phases. */
  timeLimitSeconds: number;
}

export class Game {
  readonly courses: Course[] = [phaseOne(), phaseTwo(), dungeon()];
  readonly hazards = this.courses.map((course) => new HazardField(course));
  readonly players: Player[];
  /**
   * Which of the phase 2 portals leads to the dungeon; drawn fresh every match.
   * Online it only exists on the server: snapshots never include it.
   */
  readonly correctPortal: number;
  readonly timeLimitTicks: number;
  projectiles: Projectile[] = [];
  smokes: Smoke[] = [];
  tick = 0;
  status: GameStatus = 'running';
  /** First team to have every member in the dungeon. */
  winnerTeam: number | null = null;
  /** Things that happened since the UI last drained this list. */
  events: GameEvent[] = [];
  private readonly rng: Rng;
  private nextId = 1;

  constructor(configs: PlayerConfig[], options: GameOptions) {
    this.rng = new Rng(options.seed);
    this.correctPortal = this.rng.int(this.courses[1].portals.length);
    this.timeLimitTicks = options.timeLimitSeconds * TICK_RATE;
    this.players = configs.map((config, slot) => {
      const player: Player = {
        ...config,
        slot,
        phase: 0,
        x: 0,
        y: 0,
        px: 0,
        py: 0,
        vx: 0,
        vy: 0,
        tx: 0,
        ty: 0,
        hp: PLAYER.maxHp,
        alive: true,
        respawnTicks: 0,
        invulnTicks: 0,
        cooldowns: emptyCooldowns(),
        slow: 0,
        slowTicks: 0,
        rootTicks: 0,
        blindTicks: 0,
        pull: null,
        mark: null,
        lastAttacker: null,
        kbx: 0,
        kby: 0,
        finishTick: null,
      };
      this.placeAtStart(player);
      return player;
    });
  }

  /** Clock stops when the match is decided, so afterwards it shows the time that was left. */
  get ticksLeft(): number {
    return Math.max(0, this.timeLimitTicks - this.tick);
  }

  player(id: number): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  /** Someone left mid-match (online): drop them and anything that pointed at them. */
  removePlayer(id: number): void {
    const index = this.players.findIndex((p) => p.id === id);
    if (index < 0) return;
    this.players.splice(index, 1);
    this.projectiles = this.projectiles.filter((proj) => proj.ownerId !== id);
    for (const p of this.players) {
      if (p.pull?.casterId === id) p.pull = null;
      if (p.lastAttacker?.id === id) p.lastAttacker = null;
    }
  }

  moveTo(id: number, x: number, y: number): void {
    const p = this.player(id);
    if (!p || !this.canMove(p)) return;
    p.tx = x;
    p.ty = y;
  }

  /** Casts `spell` toward (x, y). Returns false if it isn't ready or can't be cast now. */
  cast(id: number, spell: SpellId, x: number, y: number): boolean {
    const p = this.player(id);
    if (!p || !this.canMove(p) || p.cooldowns[spell] > 0) return false;

    const cast = spell === 'heal' ? this.castHeal(p, x, y) : isProjectile(spell) && this.launch(p, spell, x, y);
    if (!cast) return false;

    p.cooldowns[spell] = SPELLS[spell].cooldown;
    this.events.push({ type: 'cast', playerId: p.id, spell });
    return true;
  }

  step(): void {
    if (this.status === 'timeout') return;
    // Once the race is decided, players can still walk around wherever they are.
    if (this.status === 'finished') {
      for (const p of this.players) this.updatePlayer(p);
      return;
    }
    this.tick++;

    for (const p of this.players) this.updatePlayer(p);
    this.updateProjectiles();
    this.updateSmokes();

    this.hazards.forEach((field, phase) => {
      const inCourse = this.players.filter((p) => p.phase === phase && this.isRacing(p));
      field.update(this.rng, inCourse);
      for (const p of inCourse) {
        if (p.invulnTicks > 0) continue;
        for (const hit of field.collide(p.id, p.x, p.y, PLAYER.radius)) this.applyHazard(p, hit);
      }
    });

    for (const p of this.players) if (this.isRacing(p)) this.checkPortals(p);

    const winner = this.completeTeam();
    if (winner !== null) {
      this.winnerTeam = winner;
      this.setStatus('finished');
    } else if (this.tick >= this.timeLimitTicks) {
      this.setStatus('timeout');
    }
  }

  // --- Spells ---

  private launch(p: Player, kind: ProjectileKind, x: number, y: number): boolean {
    const dx = x - p.x;
    const dy = y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return false;
    const spec = SPELLS[kind];
    const nx = dx / dist;
    const ny = dy / dist;
    // Smoke flies to the cursor and bursts there; the rest fly their full range.
    const range = kind === 'smoke' ? Math.min(dist, spec.range) : spec.range;
    const startX = p.x + nx * PLAYER.radius;
    const startY = p.y + ny * PLAYER.radius;
    this.projectiles.push({
      id: this.nextId++,
      kind,
      ownerId: p.id,
      phase: p.phase,
      x: startX,
      y: startY,
      px: startX,
      py: startY,
      vx: nx * spec.speed,
      vy: ny * spec.speed,
      traveled: 0,
      range,
      radius: spec.radius,
    });
    return true;
  }

  private castHeal(p: Player, x: number, y: number): boolean {
    // Whoever is under the cursor (friend or foe) if in range, otherwise the caster.
    const target =
      this.players.find(
        (o) =>
          o.alive &&
          o.phase === p.phase &&
          Math.hypot(o.x - x, o.y - y) <= HEAL_PICK_RADIUS &&
          Math.hypot(o.x - p.x, o.y - p.y) <= SPELLS.heal.range,
      ) ?? p;
    const amount = Math.min(PLAYER.maxHp - target.hp, Math.round(PLAYER.maxHp * SPELLS.heal.percent));
    target.hp += amount;
    this.events.push({ type: 'heal', playerId: target.id, casterId: p.id, amount });
    return true;
  }

  private updateProjectiles(): void {
    const remaining: Projectile[] = [];
    for (const proj of this.projectiles) {
      proj.px = proj.x;
      proj.py = proj.y;
      proj.x += proj.vx;
      proj.y += proj.vy;
      proj.traveled += Math.hypot(proj.vx, proj.vy);

      // Anyone but the caster can be hit: friendly fire is on.
      const victim = this.players.find(
        (o) =>
          o.id !== proj.ownerId &&
          o.phase === proj.phase &&
          this.isRacing(o) &&
          o.invulnTicks === 0 &&
          Math.hypot(o.x - proj.x, o.y - proj.y) < proj.radius + PLAYER.radius,
      );
      if (victim) {
        this.spellHit(proj, victim);
        continue;
      }
      if (proj.traveled >= proj.range) {
        if (proj.kind === 'smoke') this.burstSmoke(proj);
        continue;
      }
      remaining.push(proj);
    }
    this.projectiles = remaining;
  }

  private spellHit(proj: Projectile, victim: Player): void {
    this.events.push({ type: 'spellHit', playerId: victim.id, casterId: proj.ownerId, spell: proj.kind });
    victim.lastAttacker = { id: proj.ownerId, tick: this.tick };
    const speed = Math.hypot(proj.vx, proj.vy) || 1;
    switch (proj.kind) {
      case 'hook':
        victim.pull = { casterId: proj.ownerId, ticks: MAX_PULL_TICKS };
        victim.kbx = victim.kby = 0;
        break;
      case 'gust': {
        const shove = SPELLS.gust.knockback * (1 - KNOCKBACK_DECAY);
        victim.kbx = (proj.vx / speed) * shove;
        victim.kby = (proj.vy / speed) * shove;
        victim.pull = null;
        this.damage(victim, SPELLS.gust.damage, 'gust');
        break;
      }
      case 'fire':
        this.damage(victim, SPELLS.fire.damage, 'fire');
        break;
      case 'mark':
        victim.mark = { phase: victim.phase, x: victim.x, y: victim.y, ticks: SPELLS.mark.returnTicks };
        break;
      case 'smoke':
        this.burstSmoke(proj);
        break;
    }
  }

  private burstSmoke(proj: Projectile): void {
    const { cloudRadius, cloudTicks } = SPELLS.smoke;
    this.smokes.push({
      id: this.nextId++,
      phase: proj.phase,
      x: proj.x,
      y: proj.y,
      radius: cloudRadius,
      ticksLeft: cloudTicks,
      totalTicks: cloudTicks,
    });
    this.events.push({ type: 'smoke', phase: proj.phase, x: proj.x, y: proj.y });
  }

  private updateSmokes(): void {
    for (const smoke of this.smokes) {
      smoke.ticksLeft--;
      for (const p of this.players) {
        if (p.alive && p.phase === smoke.phase && Math.hypot(p.x - smoke.x, p.y - smoke.y) < smoke.radius) {
          p.blindTicks = Math.max(p.blindTicks, SPELLS.smoke.blindLingerTicks);
        }
      }
    }
    this.smokes = this.smokes.filter((s) => s.ticksLeft > 0);
  }

  // --- Players ---

  private canMove(p: Player): boolean {
    return this.status !== 'timeout' && p.alive;
  }

  /** Still on the course (not dead, not in the dungeon yet). */
  private isRacing(p: Player): boolean {
    return this.status === 'running' && p.alive && p.finishTick === null;
  }

  private updatePlayer(p: Player): void {
    p.px = p.x;
    p.py = p.y;
    if (!p.alive) {
      if (--p.respawnTicks <= 0) this.respawn(p);
      return;
    }
    if (p.invulnTicks > 0) p.invulnTicks--;
    if (p.blindTicks > 0) p.blindTicks--;
    for (const spell of Object.keys(p.cooldowns) as SpellId[]) {
      if (p.cooldowns[spell] > 0) p.cooldowns[spell]--;
    }
    const speed = PLAYER.speed * (p.slowTicks > 0 ? 1 - p.slow : 1);
    if (p.slowTicks > 0 && --p.slowTicks === 0) p.slow = 0;

    let nx = p.x + p.kbx;
    let ny = p.y + p.kby;
    if (p.pull) {
      const pulled = this.pullStep(p);
      nx = pulled.x;
      ny = pulled.y;
    } else if (p.rootTicks > 0) {
      p.rootTicks--;
    } else {
      const dx = p.tx - p.x;
      const dy = p.ty - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.01) {
        const step = Math.min(speed, dist);
        nx += (dx / dist) * step;
        ny += (dy / dist) * step;
      }
    }
    p.kbx *= KNOCKBACK_DECAY;
    p.kby *= KNOCKBACK_DECAY;
    if (Math.hypot(p.kbx, p.kby) < 0.05) p.kbx = p.kby = 0;

    const pos = clampToCourse(this.courses[p.phase], nx, ny, PLAYER.radius);
    p.vx = pos.x - p.x;
    p.vy = pos.y - p.y;
    p.x = pos.x;
    p.y = pos.y;
    // Being moved by someone else shouldn't make the player walk back to where they were.
    if (p.kbx !== 0 || p.kby !== 0 || p.pull || p.rootTicks > 0) {
      p.tx = p.x;
      p.ty = p.y;
    }

    this.updateMark(p);
  }

  /** One tick of being dragged toward the hook caster; ends in a root. */
  private pullStep(p: Player): { x: number; y: number } {
    const pull = p.pull!;
    const caster = this.player(pull.casterId);
    if (!caster || !caster.alive || caster.phase !== p.phase) {
      p.pull = null;
      return { x: p.x, y: p.y };
    }
    const dx = p.x - caster.x;
    const dy = p.y - caster.y;
    const dist = Math.hypot(dx, dy) || 1;
    const goalX = caster.x + (dx / dist) * HOOK_STOP_DISTANCE;
    const goalY = caster.y + (dy / dist) * HOOK_STOP_DISTANCE;
    const gx = goalX - p.x;
    const gy = goalY - p.y;
    const left = Math.hypot(gx, gy);
    const step = Math.min(SPELLS.hook.pullSpeed, left);
    if (--pull.ticks <= 0 || left <= SPELLS.hook.pullSpeed) {
      p.pull = null;
      p.rootTicks = SPELLS.hook.rootTicks;
    }
    return left > 0 ? { x: p.x + (gx / left) * step, y: p.y + (gy / left) * step } : { x: p.x, y: p.y };
  }

  private updateMark(p: Player): void {
    const mark = p.mark;
    if (!mark || --mark.ticks > 0) return;
    p.mark = null;
    if (mark.phase !== p.phase) return;
    this.events.push({ type: 'recall', playerId: p.id, fromX: p.x, fromY: p.y, toX: mark.x, toY: mark.y });
    p.x = p.px = p.tx = mark.x;
    p.y = p.py = p.ty = mark.y;
    p.kbx = p.kby = 0;
    p.pull = null;
  }

  private applyHazard(p: Player, hit: HazardHit): void {
    // The strongest slow wins; an equal or weaker one only refreshes it if nothing stronger is running.
    if (hit.slow >= p.slow || p.slowTicks === 0) {
      p.slow = hit.slow;
      p.slowTicks = Math.max(p.slowTicks, hit.slowTicks);
    }
    if (hit.push) {
      // Total distance of a decaying shove is v / (1 - decay).
      const speed = CONFIG.wallIce.knockback * (1 - KNOCKBACK_DECAY);
      p.kbx = hit.push.x * speed;
      p.kby = hit.push.y * speed;
      p.pull = null;
    }
    this.damage(p, hit.damage, hit.source);
  }

  private damage(p: Player, amount: number, source: DamageSource): void {
    p.hp = Math.max(0, p.hp - amount);
    p.invulnTicks = PLAYER.hitInvulnTicks;
    this.events.push({ type: 'hit', playerId: p.id, damage: amount, source });
    if (p.hp > 0) return;
    p.alive = false;
    p.respawnTicks = PLAYER.respawnTicks;
    this.events.push({ type: 'death', playerId: p.id, killerId: this.killerOf(p), phase: p.phase, x: p.x, y: p.y });
  }

  /**
   * Who gets the kill: whoever last hit the victim with a spell, if recent enough. That includes
   * deaths on the ice right after being pushed, hooked or marked there.
   */
  private killerOf(p: Player): number | null {
    const attacker = p.lastAttacker;
    if (!attacker || attacker.id === p.id) return null;
    return this.tick - attacker.tick <= KILL_CREDIT_TICKS ? attacker.id : null;
  }

  /** Death only sends this player back to the start of the phase they're in. */
  private respawn(p: Player): void {
    p.alive = true;
    p.hp = PLAYER.maxHp;
    p.invulnTicks = PLAYER.respawnInvulnTicks;
    this.placeAtStart(p);
    this.events.push({ type: 'respawn', playerId: p.id });
  }

  private checkPortals(p: Player): void {
    const portals = this.courses[p.phase].portals;
    const entered = portals.findIndex((portal) => Math.hypot(p.x - portal.x, p.y - portal.y) < PORTAL_ENTER_DISTANCE);
    if (entered < 0) return;

    if (p.phase === 0) {
      this.moveToPhase(p, 1);
    } else if (entered === this.correctPortal) {
      p.finishTick = this.tick;
      this.moveToPhase(p, DUNGEON_PHASE);
      this.events.push({ type: 'finish', playerId: p.id });
    } else {
      // Wrong portal: only whoever went in goes back to the start of phase 2.
      p.invulnTicks = PLAYER.respawnInvulnTicks;
      this.placeAtStart(p);
      this.events.push({ type: 'wrongPortal', playerId: p.id });
    }
  }

  private moveToPhase(p: Player, phase: number): void {
    p.phase = phase;
    p.invulnTicks = PLAYER.respawnInvulnTicks;
    this.placeAtStart(p);
    this.events.push({ type: 'phase', playerId: p.id, phase });
  }

  /**
   * Back to the start of the current phase (respawn, wrong portal, new phase) with a clean
   * state: effects don't tick while dead, so without this the player would come back slowed.
   */
  private placeAtStart(p: Player): void {
    const { start } = this.courses[p.phase];
    const [ox, oy] = START_OFFSETS[p.slot % START_OFFSETS.length];
    p.x = p.px = p.tx = start.x + ox;
    p.y = p.py = p.ty = start.y + oy;
    p.vx = p.vy = p.kbx = p.kby = 0;
    p.slow = p.slowTicks = 0;
    p.rootTicks = p.blindTicks = 0;
    p.pull = null;
    p.mark = null;
    p.lastAttacker = null;
  }

  /** Team whose every (remaining) member reached the dungeon, if any. */
  private completeTeam(): number | null {
    const teams = new Set(this.players.map((p) => p.team));
    for (const team of teams) {
      const members = this.players.filter((p) => p.team === team);
      if (members.length > 0 && members.every((p) => p.finishTick !== null)) return team;
    }
    return null;
  }

  private setStatus(status: GameStatus): void {
    this.status = status;
    this.events.push({ type: 'status', status });
  }
}
