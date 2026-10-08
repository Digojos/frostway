import { CONFIG } from '../config';
import { HALF_WIDTH, PORTAL_RADIUS, zoneIndexAt, type Course, type HazardKind, type Point, type Zone } from './course';
import type { Rng } from './rng';
import { seconds, TICK_RATE } from './time';

/** Ice erupting from the ground: a warning circle, then spikes that hurt, then they melt away. */
export interface Spike {
  id: number;
  x: number;
  y: number;
  radius: number;
  age: number;
  hits: Set<number>;
}

/** Sausage-shaped ice coming out of a side wall and reaching the middle of the corridor. */
export interface Banana {
  id: number;
  zone: number;
  /** Position along the zone's travel axis. */
  along: number;
  /** -1 = from the wall at the low coordinate, 1 = from the high one. */
  side: -1 | 1;
  age: number;
  hits: Set<number>;
}

/** Segment from the wall to the tip, swept by a circle of `radius`. */
export interface Capsule {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  radius: number;
}

export interface HazardTarget {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** What touching an obstacle does to a player. */
export interface HazardHit {
  source: 'groundIce' | 'wallIce';
  damage: number;
  slow: number;
  slowTicks: number;
  /** Unit direction to shove the player, or null. */
  push: Point | null;
}

const ground = CONFIG.groundIce;
const wall = CONFIG.wallIce;

export const SPIKE_TIMING = {
  warn: seconds(ground.warnSeconds),
  active: seconds(ground.activeSeconds),
  fade: seconds(ground.fadeSeconds),
};
export const BANANA_TIMING = {
  warn: seconds(wall.warnSeconds),
  extend: seconds(wall.extendSeconds),
  hold: seconds(wall.holdSeconds),
  retract: seconds(wall.retractSeconds),
};
export const BANANA_RADIUS = wall.thickness / 2;

/** Chance per tick that a zone near a player spawns an obstacle. */
const SPAWN_CHANCE: Record<HazardKind, number> = {
  none: 0,
  smallSpikes: ground.spawnPerSecond.small / TICK_RATE,
  bigSpikes: ground.spawnPerSecond.big / TICK_RATE,
  bananas: wall.spawnPerSecond / TICK_RATE,
  mixed: CONFIG.mixedSpawnPerSecond / TICK_RATE,
};
const SAFE_DISTANCE = 160;
const BANANA_MIN_GAP = 140;
/** A sausage only hurts once it's this far out of the wall. */
const BANANA_HARMFUL_EXTENT = 0.3;

const SPIKE_LIFETIME = SPIKE_TIMING.warn + SPIKE_TIMING.active + SPIKE_TIMING.fade;
const BANANA_LIFETIME = BANANA_TIMING.warn + BANANA_TIMING.extend + BANANA_TIMING.hold + BANANA_TIMING.retract;

export function spikePhase(spike: Spike): { phase: 'warn' | 'active' | 'fade'; progress: number } {
  const { warn, active, fade } = SPIKE_TIMING;
  if (spike.age < warn) return { phase: 'warn', progress: spike.age / warn };
  if (spike.age < warn + active) return { phase: 'active', progress: (spike.age - warn) / active };
  return { phase: 'fade', progress: Math.min(1, (spike.age - warn - active) / fade) };
}

/** How far the sausage is out of the wall: 0 (inside / warning) to 1 (reaching the middle). */
export function bananaExtent(banana: Banana): number {
  const { warn, extend, hold, retract } = BANANA_TIMING;
  let t = banana.age - warn;
  if (t < 0) return 0;
  if (t < extend) return t / extend;
  t -= extend;
  if (t < hold) return 1;
  t -= hold;
  return t < retract ? 1 - t / retract : 0;
}

export function bananaCapsule(zone: Zone, banana: Banana, extent: number): Capsule {
  const reach = extent * (HALF_WIDTH - BANANA_RADIUS);
  const inward = -banana.side;
  if (zone.axis === 'x') {
    const wallY = banana.side < 0 ? zone.y0 : zone.y1;
    return { ax: banana.along, ay: wallY, bx: banana.along, by: wallY + inward * reach, radius: BANANA_RADIUS };
  }
  const wallX = banana.side < 0 ? zone.x0 : zone.x1;
  return { ax: wallX, ay: banana.along, bx: wallX + inward * reach, by: banana.along, radius: BANANA_RADIUS };
}

export class HazardField {
  spikes: Spike[] = [];
  bananas: Banana[] = [];
  private nextId = 1;

  constructor(readonly course: Course) {}

  update(rng: Rng, targets: HazardTarget[]): void {
    for (const s of this.spikes) s.age++;
    for (const b of this.bananas) b.age++;
    this.spikes = this.spikes.filter((s) => s.age < SPIKE_LIFETIME);
    this.bananas = this.bananas.filter((b) => b.age < BANANA_LIFETIME);

    // Obstacles only appear where someone is (and just ahead of them).
    const active = new Set<number>();
    for (const t of targets) {
      const zone = zoneIndexAt(this.course, t.x, t.y);
      if (zone < 0) continue;
      active.add(zone);
      if (zone + 1 < this.course.zones.length) active.add(zone + 1);
    }
    for (const index of active) {
      const zone = this.course.zones[index];
      if (rng.next() < SPAWN_CHANCE[zone.hazard]) this.spawn(zone, rng, targets);
    }
  }

  /** What hits a player this tick; each obstacle hits a given player at most once. */
  collide(playerId: number, x: number, y: number, radius: number): HazardHit[] {
    const hits: HazardHit[] = [];
    for (const s of this.spikes) {
      if (s.hits.has(playerId) || spikePhase(s).phase !== 'active') continue;
      if (Math.hypot(x - s.x, y - s.y) < s.radius + radius * 0.5) {
        s.hits.add(playerId);
        hits.push({
          source: 'groundIce',
          damage: ground.damage,
          slow: ground.slow,
          slowTicks: seconds(ground.slowSeconds),
          push: null,
        });
      }
    }
    for (const b of this.bananas) {
      const extent = bananaExtent(b);
      if (b.hits.has(playerId) || extent < BANANA_HARMFUL_EXTENT) continue;
      const zone = this.course.zones[b.zone];
      const capsule = bananaCapsule(zone, b, extent);
      if (distanceToSegment(x, y, capsule) >= capsule.radius + radius) continue;
      b.hits.add(playerId);
      // Pushed toward whichever side of the sausage the player touched: ahead of it goes forward, behind goes back.
      const along = zone.axis === 'x' ? x : y;
      const dir = Math.sign(along - b.along) || 1;
      const push = zone.axis === 'x' ? { x: dir, y: 0 } : { x: 0, y: dir };
      hits.push({ source: 'wallIce', damage: wall.damage, slow: wall.slow, slowTicks: seconds(wall.slowSeconds), push });
    }
    return hits;
  }

  private spawn(zone: Zone, rng: Rng, targets: HazardTarget[]): void {
    const kind = zone.hazard === 'mixed' ? (rng.next() < 0.5 ? 'bigSpikes' : 'bananas') : zone.hazard;
    if (kind === 'bananas') this.spawnBanana(zone, rng);
    else this.spawnSpike(zone, kind === 'bigSpikes' ? ground.bigRadius : ground.smallRadius, rng, targets);
  }

  private spawnSpike(zone: Zone, radius: number, rng: Rng, targets: HazardTarget[]): void {
    const inZone = targets.filter((t) => zoneIndexAt(this.course, t.x, t.y) === zone.index);
    let x: number;
    let y: number;
    if (inZone.length > 0 && rng.next() < ground.targetedShare) {
      // Aim where the player will be when the ice comes out.
      const t = rng.pick(inZone);
      const lead = SPIKE_TIMING.warn * 0.6;
      x = t.x + t.vx * lead + rng.range(-30, 30);
      y = t.y + t.vy * lead + rng.range(-30, 30);
    } else {
      x = rng.range(zone.x0, zone.x1);
      y = rng.range(zone.y0, zone.y1);
    }
    const margin = radius * 0.5;
    x = Math.max(zone.x0 + margin, Math.min(zone.x1 - margin, x));
    y = Math.max(zone.y0 + margin, Math.min(zone.y1 - margin, y));

    const nearStart = Math.hypot(x - this.course.start.x, y - this.course.start.y) < SAFE_DISTANCE;
    const nearPortal = this.course.portals.some((p) => Math.hypot(x - p.x, y - p.y) < PORTAL_RADIUS + radius + 20);
    if (nearStart || nearPortal) return;
    this.spikes.push({ id: this.nextId++, x, y, radius, age: 0, hits: new Set() });
  }

  private spawnBanana(zone: Zone, rng: Rng): void {
    const min = zone.a0 + HALF_WIDTH + BANANA_RADIUS;
    const max = zone.a1 - HALF_WIDTH - BANANA_RADIUS;
    if (max <= min) return;
    const along = rng.range(min, max);
    const side: -1 | 1 = rng.next() < 0.5 ? -1 : 1;
    // Never close both halves of the corridor at the same spot.
    const blocked = this.bananas.some((b) => b.zone === zone.index && Math.abs(b.along - along) < BANANA_MIN_GAP);
    if (blocked) return;
    this.bananas.push({ id: this.nextId++, zone: zone.index, along, side, age: 0, hits: new Set() });
  }
}

export function distanceToSegment(x: number, y: number, c: Capsule): number {
  const dx = c.bx - c.ax;
  const dy = c.by - c.ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - c.ax) * dx + (y - c.ay) * dy) / len2)) : 0;
  return Math.hypot(x - (c.ax + dx * t), y - (c.ay + dy * t));
}
