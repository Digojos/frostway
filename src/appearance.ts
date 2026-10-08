/** Purely cosmetic look of a player. Travels with the player's data so other clients can draw it. */
export interface Appearance {
  name: string;
  body: Body;
  outfit: string;
  pants: string;
  skin: string;
  eyes: string;
  hair: string;
  hairStyle: HairStyle;
  beard: Beard;
  headwear: Headwear;
  cape: boolean;
  /** Color of the cape and of cloth accessories (bandana). */
  accent: string;
  weapon: Weapon;
}

export type Body = 'masculine' | 'feminine';
export type HairStyle = 'short' | 'bangs' | 'long' | 'ponytail' | 'braid' | 'bald';
export type Beard = 'none' | 'stubble' | 'short' | 'full' | 'mustache';
export type Headwear = 'none' | 'hood' | 'wizard' | 'helmet' | 'bandana' | 'crown';
export type Weapon = 'none' | 'sword' | 'staff' | 'bow';

export const OUTFIT_COLORS = [
  '#c8342c',
  '#2f6fd6',
  '#3a9a4a',
  '#8a44c8',
  '#d68a1f',
  '#1f9aa6',
  '#e05a8a',
  '#7a5230',
  '#9bb7d4',
  '#d9d9d9',
  '#3a3a44',
];
export const PANTS_COLORS = ['#3b2f2a', '#4a5568', '#2c3e66', '#5a3e22', '#2f4f2f', '#5c1f1f', '#d9d9d9', '#1e1e24'];
export const SKIN_TONES = ['#f6d7bd', '#e8b98e', '#c98d5f', '#9a6440', '#6b4127'];
export const EYE_COLORS = ['#1a1a1a', '#3a6ad6', '#3a8a4a', '#7a4a1f', '#b8382c', '#8a44c8'];
export const HAIR_COLORS = ['#2a1d14', '#6b3e1f', '#c9a050', '#e8e0c8', '#8a8a8a', '#b8382c', '#e07ab8', '#3a6ad6', '#3f8f4f'];
export const ACCENT_COLORS = ['#5c1f1f', '#b8382c', '#1f2f5c', '#2f4f2f', '#4a2a6a', '#1e1e24', '#d9d9d9', '#d6b25a'];

export const BODIES: Record<Body, string> = {
  masculine: 'Masculino',
  feminine: 'Feminino',
};

export const HAIR_STYLES: Record<HairStyle, string> = {
  short: 'Curto',
  bangs: 'Franja',
  long: 'Longo',
  ponytail: 'Rabo de cavalo',
  braid: 'Trança',
  bald: 'Careca',
};

export const BEARDS: Record<Beard, string> = {
  none: 'Nenhuma',
  stubble: 'Por fazer',
  short: 'Curta',
  full: 'Cheia',
  mustache: 'Bigode',
};

export const HEADWEAR: Record<Headwear, string> = {
  none: 'Nenhum',
  hood: 'Capuz',
  wizard: 'Chapéu de mago',
  helmet: 'Elmo',
  bandana: 'Bandana',
  crown: 'Coroa',
};

export const WEAPONS: Record<Weapon, string> = {
  none: 'Nenhuma',
  sword: 'Espada',
  staff: 'Cajado',
  bow: 'Arco',
};

export const MAX_NAME_LENGTH = 16;

export const DEFAULT_APPEARANCE: Appearance = {
  name: 'Você',
  body: 'masculine',
  outfit: OUTFIT_COLORS[0],
  pants: PANTS_COLORS[0],
  skin: SKIN_TONES[0],
  eyes: EYE_COLORS[0],
  hair: HAIR_COLORS[1],
  hairStyle: 'short',
  beard: 'none',
  headwear: 'none',
  cape: false,
  accent: ACCENT_COLORS[0],
  weapon: 'none',
};

const STORAGE_KEY = 'frostway.appearance';

/** Saved look, falling back to defaults for anything missing or invalid. */
export function loadAppearance(): Appearance {
  let saved: Partial<Appearance> = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Appearance>;
  } catch {
    // Ignore unreadable storage.
  }
  return sanitizeAppearance(saved);
}

export function saveAppearance(appearance: Appearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // Storage unavailable: the look just won't persist.
  }
}

/** A random look, used for bots. */
export function randomAppearance(name: string): Appearance {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];
  const option = <T extends string>(options: Record<T, string>): T => pick(Object.keys(options) as T[]);
  return sanitizeAppearance({
    name,
    body: option(BODIES),
    outfit: pick(OUTFIT_COLORS),
    pants: pick(PANTS_COLORS),
    skin: pick(SKIN_TONES),
    eyes: pick(EYE_COLORS),
    hair: pick(HAIR_COLORS),
    hairStyle: option(HAIR_STYLES),
    beard: option(BEARDS),
    headwear: option(HEADWEAR),
    cape: Math.random() < 0.4,
    accent: pick(ACCENT_COLORS),
    weapon: option(WEAPONS),
  });
}

/** Accepts only known options, so a tampered save (or another client) can't break drawing. */
export function sanitizeAppearance(input: Partial<Appearance>): Appearance {
  const d = DEFAULT_APPEARANCE;
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  const keys = <T extends string>(options: Record<T, string>) => Object.keys(options) as T[];
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, MAX_NAME_LENGTH) : '';
  return {
    name: name || d.name,
    body: pick(input.body, keys(BODIES), d.body),
    outfit: pick(input.outfit, OUTFIT_COLORS, d.outfit),
    pants: pick(input.pants, PANTS_COLORS, d.pants),
    skin: pick(input.skin, SKIN_TONES, d.skin),
    eyes: pick(input.eyes, EYE_COLORS, d.eyes),
    hair: pick(input.hair, HAIR_COLORS, d.hair),
    hairStyle: pick(input.hairStyle, keys(HAIR_STYLES), d.hairStyle),
    beard: pick(input.beard, keys(BEARDS), d.beard),
    headwear: pick(input.headwear, keys(HEADWEAR), d.headwear),
    cape: typeof input.cape === 'boolean' ? input.cape : d.cape,
    accent: pick(input.accent, ACCENT_COLORS, d.accent),
    weapon: pick(input.weapon, keys(WEAPONS), d.weapon),
  };
}
