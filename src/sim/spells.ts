import { CONFIG } from '../config';
import { seconds, TICK_RATE } from './time';

export type SpellId = 'hook' | 'heal' | 'gust' | 'smoke' | 'fire' | 'mark';
/** Skill bar order: key 1 is the first. */
export const SPELL_ORDER: SpellId[] = ['hook', 'heal', 'gust', 'smoke', 'fire', 'mark'];

export type ProjectileKind = 'hook' | 'gust' | 'smoke' | 'fire' | 'mark';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  ownerId: number;
  phase: number;
  x: number;
  y: number;
  /** Position before the last step, for render interpolation. */
  px: number;
  py: number;
  /** Velocity per tick. */
  vx: number;
  vy: number;
  traveled: number;
  range: number;
  radius: number;
}

/** Black cloud left by the smoke spell. */
export interface Smoke {
  id: number;
  phase: number;
  x: number;
  y: number;
  radius: number;
  ticksLeft: number;
  totalTicks: number;
}

/** Recall mark: the player is sent back to (x, y) when `ticks` runs out. */
export interface Mark {
  phase: number;
  x: number;
  y: number;
  ticks: number;
}

const s = CONFIG.spells;
const perTick = (unitsPerSecond: number) => unitsPerSecond / TICK_RATE;

/** Spell numbers converted to simulation units (ticks, units per tick). */
export const SPELLS = {
  hook: {
    range: s.hook.range,
    speed: perTick(s.hook.speed),
    radius: s.hook.radius,
    cooldown: seconds(s.hook.cooldownSeconds),
    pullSpeed: perTick(s.hook.pullSpeed),
    rootTicks: seconds(s.hook.rootSeconds),
  },
  heal: { range: s.heal.range, percent: s.heal.percent, cooldown: seconds(s.heal.cooldownSeconds) },
  gust: {
    range: s.gust.range,
    speed: perTick(s.gust.speed),
    radius: s.gust.radius,
    cooldown: seconds(s.gust.cooldownSeconds),
    damage: s.gust.damage,
    knockback: s.gust.knockback,
  },
  smoke: {
    range: s.smoke.range,
    speed: perTick(s.smoke.speed),
    radius: s.smoke.radius,
    cooldown: seconds(s.smoke.cooldownSeconds),
    cloudRadius: s.smoke.cloudRadius,
    cloudTicks: seconds(s.smoke.cloudSeconds),
    blindLingerTicks: seconds(s.smoke.blindLingerSeconds),
  },
  fire: {
    range: s.fire.range,
    speed: perTick(s.fire.speed),
    radius: s.fire.radius,
    cooldown: seconds(s.fire.cooldownSeconds),
    damage: s.fire.damage,
  },
  mark: {
    range: s.mark.range,
    speed: perTick(s.mark.speed),
    radius: s.mark.radius,
    cooldown: seconds(s.mark.cooldownSeconds),
    returnTicks: seconds(s.mark.returnSeconds),
  },
};

export const spellRange = (spell: SpellId): number => SPELLS[spell].range;
export const spellCooldown = (spell: SpellId): number => SPELLS[spell].cooldown;

export const isProjectile = (spell: SpellId): spell is ProjectileKind =>
  spell === 'hook' || spell === 'gust' || spell === 'smoke' || spell === 'fire' || spell === 'mark';

export const emptyCooldowns = (): Record<SpellId, number> => ({
  hook: 0,
  heal: 0,
  gust: 0,
  smoke: 0,
  fire: 0,
  mark: 0,
});
