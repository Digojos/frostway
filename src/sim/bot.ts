import { CONFIG } from '../config';
import { clampToCourse, zoneIndexAt, type Course, type Point } from './course';
import { DUNGEON_PHASE, PLAYER, type Game, type GameEvent, type Player } from './game';
import { bananaCapsule, BANANA_TIMING, distanceToSegment, spikePhase } from './hazards';
import { Rng } from './rng';
import { SPELLS, spellRange, type SpellId } from './spells';
import { TICK_RATE } from './time';

/** Spells a bot throws at rivals, strongest effect first. */
const ATTACKS: SpellId[] = ['hook', 'mark', 'gust', 'fire', 'smoke'];
/** Bots never aim perfectly, so rivals can dodge. */
const AIM_ERROR = 25;
const WAYPOINT_JITTER = 30;
const DODGE_DIRECTIONS = 16;
/** Distances ahead checked for danger along each candidate direction. */
const LOOK_AHEAD = [8, 20, 36];
const DODGE_MARGIN = 6;

/**
 * Simple rival: follows the course from corner to corner (ignoring obstacles), tries the
 * phase 2 portals one by one, throws spells at whoever is in range and heals when hurt.
 * It only uses the same public actions a human has (moveTo / cast).
 */
export class Bot {
  /** Phase 2 portals already found to be wrong. */
  private readonly wrongPortals = new Set<number>();
  private portalTry = 0;
  private readonly rng: Rng;

  constructor(
    readonly playerId: number,
    seed: number,
  ) {
    this.rng = new Rng(seed);
  }

  onEvent(event: GameEvent): void {
    if (event.type === 'wrongPortal' && event.playerId === this.playerId) {
      this.wrongPortals.add(this.portalTry);
    }
  }

  think(game: Game): void {
    const me = game.player(this.playerId);
    if (!me || !me.alive || me.phase === DUNGEON_PHASE) return;

    const target = this.nextWaypoint(game.courses[me.phase], me);
    const step = this.safeStep(game, me, target);
    game.moveTo(me.id, step.x, step.y);

    if (me.hp < PLAYER.maxHp * CONFIG.bots.healBelow && me.cooldowns.heal === 0) {
      game.cast(me.id, 'heal', me.x, me.y);
      return;
    }
    if (this.rng.next() < CONFIG.bots.castsPerSecond / TICK_RATE) this.attack(game, me);
  }

  private nextWaypoint(course: Course, me: Player): Point {
    const zone = zoneIndexAt(course, me.x, me.y);
    const last = course.zones.length - 1;
    if (zone >= 0 && zone < last) {
      // Middle of the overlap with the next zone, i.e. the next corner of the course.
      const a = course.zones[zone];
      const b = course.zones[zone + 1];
      return {
        x: (Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1)) / 2 + this.jitter(me.id, zone, 0),
        y: (Math.max(a.y0, b.y0) + Math.min(a.y1, b.y1)) / 2 + this.jitter(me.id, zone, 1),
      };
    }
    if (course.portals.length === 1) return course.portals[0];
    // Phase 2 hall: walk into a portal not yet known to be wrong.
    while (this.wrongPortals.has(this.portalTry % course.portals.length)) this.portalTry++;
    this.portalTry %= course.portals.length;
    return course.portals[this.portalTry];
  }

  /**
   * Local dodging: tries a fan of directions, looks a few steps ahead along each and picks
   * the one that heads closest to the target without walking into warned ice.
   */
  private safeStep(game: Game, me: Player, target: Point): Point {
    const course = game.courses[me.phase];
    const dangers = this.dangers(game, me.phase);
    const toTarget = Math.atan2(target.y - me.y, target.x - me.x);
    if (dangers.length === 0) return target;

    let best = { score: -Infinity, x: target.x, y: target.y };
    for (let i = 0; i < DODGE_DIRECTIONS; i++) {
      const angle = toTarget + (i / DODGE_DIRECTIONS) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      let danger = 0;
      for (const ahead of LOOK_AHEAD) {
        const p = clampToCourse(course, me.x + dx * ahead, me.y + dy * ahead, PLAYER.radius);
        danger += dangers.filter((d) => d.contains(p.x, p.y)).length;
      }
      // Heading toward the target counts, but never more than staying out of danger.
      const score = Math.cos(angle - toTarget) - danger * 10;
      if (score > best.score) best = { score, x: me.x + dx * 80, y: me.y + dy * 80 };
    }
    return best;
  }

  /** Areas about to hurt: warned or active ground ice, and wall sausages coming out. */
  private dangers(game: Game, phase: number): { contains(x: number, y: number): boolean }[] {
    const field = game.hazards[phase];
    const margin = PLAYER.radius + DODGE_MARGIN;
    const list: { contains(x: number, y: number): boolean }[] = [];
    for (const spike of field.spikes) {
      const { phase: state, progress } = spikePhase(spike);
      if (state === 'fade' || (state === 'warn' && progress < 0.15)) continue;
      list.push({ contains: (x, y) => Math.hypot(x - spike.x, y - spike.y) < spike.radius + margin });
    }
    for (const banana of field.bananas) {
      if (banana.age > BANANA_TIMING.warn + BANANA_TIMING.extend + BANANA_TIMING.hold) continue;
      const c = bananaCapsule(field.course.zones[banana.zone], banana, 1);
      list.push({ contains: (x, y) => distanceToSegment(x, y, c) < c.radius + margin });
    }
    return list;
  }

  /** Small fixed offset per corner so bots don't all walk the exact same line. */
  private jitter(id: number, zone: number, axis: number): number {
    const h = Math.sin(id * 12.9898 + zone * 78.233 + axis * 37.719) * 43758.5453;
    return (h - Math.floor(h) - 0.5) * 2 * WAYPOINT_JITTER;
  }

  private attack(game: Game, me: Player): void {
    const rivals = game.players
      .filter((o) => o.team !== me.team && o.alive && o.phase === me.phase && o.finishTick === null)
      .map((o) => ({ o, dist: Math.hypot(o.x - me.x, o.y - me.y) }))
      .sort((a, b) => a.dist - b.dist);
    const nearest = rivals[0];
    if (!nearest) return;

    const ready = ATTACKS.filter((spell) => me.cooldowns[spell] === 0 && nearest.dist <= spellRange(spell) * 0.9);
    if (ready.length === 0) return;
    const spell = this.rng.pick(ready);

    // Lead the target a bit: aim where it will be when the projectile arrives.
    const speed = 'speed' in SPELLS[spell] ? (SPELLS[spell] as { speed: number }).speed : 10;
    const flight = nearest.dist / speed;
    const aimX = nearest.o.x + nearest.o.vx * flight + this.rng.range(-AIM_ERROR, AIM_ERROR);
    const aimY = nearest.o.y + nearest.o.vy * flight + this.rng.range(-AIM_ERROR, AIM_ERROR);
    game.cast(me.id, spell, aimX, aimY);
  }
}
