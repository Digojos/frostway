export interface Point {
  x: number;
  y: number;
}

/** Which obstacles a stretch of corridor produces. */
export type HazardKind = 'none' | 'smallSpikes' | 'bigSpikes' | 'bananas' | 'mixed';

/**
 * Walkable axis-aligned rectangle. Corridor zones overlap at the corners, so the
 * course is the union of all zones. `index` follows the path order.
 */
export interface Zone {
  index: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Direction of travel along this zone. */
  axis: 'x' | 'y';
  /** Straight part of the zone along `axis`, between the two corners. */
  a0: number;
  a1: number;
  hazard: HazardKind;
}

export interface Course {
  name: string;
  /** Visual style: snowy cliffs over the void, or a stone dungeon. */
  theme: 'ice' | 'dungeon';
  zones: Zone[];
  start: Point;
  portals: Point[];
}

export const CORRIDOR_WIDTH = 140;
export const HALF_WIDTH = CORRIDOR_WIDTH / 2;
export const PORTAL_RADIUS = 34;

type Dir = 'E' | 'W' | 'N' | 'S';
type Move = [Dir, number, HazardKind];
const STEP: Record<Dir, Point> = { E: { x: 1, y: 0 }, W: { x: -1, y: 0 }, N: { x: 0, y: -1 }, S: { x: 0, y: 1 } };

/** Builds a corridor from (0, 0) following straight moves; each move becomes one zone. */
function corridor(moves: Move[]): { zones: Zone[]; end: Point } {
  let x = 0;
  let y = 0;
  const zones = moves.map(([dir, length, hazard], index): Zone => {
    const nx = x + STEP[dir].x * length;
    const ny = y + STEP[dir].y * length;
    const axis = STEP[dir].x !== 0 ? 'x' : 'y';
    const zone: Zone = {
      index,
      x0: Math.min(x, nx) - HALF_WIDTH,
      y0: Math.min(y, ny) - HALF_WIDTH,
      x1: Math.max(x, nx) + HALF_WIDTH,
      y1: Math.max(y, ny) + HALF_WIDTH,
      axis,
      a0: axis === 'x' ? Math.min(x, nx) : Math.min(y, ny),
      a1: axis === 'x' ? Math.max(x, nx) : Math.max(y, ny),
      hazard,
    };
    x = nx;
    y = ny;
    return zone;
  });
  return { zones, end: { x, y } };
}

/**
 * Phase 1: square spiral inward. Ground ice grows after the 2nd curve and turns
 * into side "bananas" after the 4th. Lanes are 250 apart (110 of void between them).
 * It starts at the north-east corner, which is the right-hand tip on the isometric
 * screen, matching where the player appears on DarkEden's minimap.
 */
export function phaseOne(): Course {
  const { zones, end } = corridor([
    ['W', 1500, 'smallSpikes'],
    ['S', 1000, 'smallSpikes'],
    ['E', 1250, 'bigSpikes'],
    ['N', 750, 'bigSpikes'],
    ['W', 1000, 'bananas'],
    ['S', 500, 'bananas'],
    ['E', 750, 'bananas'],
  ]);
  return { name: 'Fase 1 · Caracol', theme: 'ice', zones, start: { x: 0, y: 0 }, portals: [end] };
}

/**
 * Phase 2: zigzag ending in a hall with three portals, one of them correct.
 * Like phase 1, it starts at the right-hand tip of the isometric screen, and the
 * first corridor runs up the screen from there.
 */
export function phaseTwo(): Course {
  const { zones, end } = corridor([
    ['W', 900, 'bigSpikes'],
    ['S', 260, 'none'],
    ['E', 900, 'bigSpikes'],
    ['S', 260, 'none'],
    ['W', 900, 'bananas'],
    ['S', 260, 'none'],
    ['E', 900, 'mixed'],
    ['S', 260, 'none'],
    ['W', 900, 'mixed'],
    ['W', 400, 'none'],
  ]);
  const hall: Zone = {
    index: zones.length,
    x0: end.x - 420,
    y0: end.y - 220,
    x1: end.x - 40,
    y1: end.y + 220,
    axis: 'x',
    a0: end.x - 420,
    a1: end.x - 40,
    hazard: 'none',
  };
  // Triangle lying along the corridor: two portals flanking the hall entrance and one
  // further in, in the middle. The front pair is 180 apart so there's room to walk
  // between them to the back one.
  // Ordered as seen on screen by a player walking in: 0 = front left, 1 = back middle, 2 = front right.
  const portals = [
    { x: end.x - 140, y: end.y + 90 },
    { x: end.x - 300, y: end.y },
    { x: end.x - 140, y: end.y - 90 },
  ];
  return { name: 'Fase 2 · Zigue-zague', theme: 'ice', zones: [...zones, hall], start: { x: 0, y: 0 }, portals };
}

/** Where the correct portal leads: a stone dungeon with no obstacles (for now). */
export function dungeon(): Course {
  const room = (index: number, x0: number, y0: number, x1: number, y1: number): Zone => ({
    index,
    x0,
    y0,
    x1,
    y1,
    axis: 'x',
    a0: x0,
    a1: x1,
    hazard: 'none',
  });
  return {
    name: 'Dungeon',
    theme: 'dungeon',
    zones: [
      room(0, -220, -220, 220, 220), // entrance chamber
      room(1, -900, -80, -200, 80), // corridor
      room(2, -1700, -420, -880, 420), // great hall
    ],
    start: { x: 0, y: 0 },
    portals: [],
  };
}

/** Highest-index zone containing the point (corners belong to the later zone), or -1. */
export function zoneIndexAt(course: Course, x: number, y: number): number {
  let found = -1;
  for (const z of course.zones) {
    if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) found = z.index;
  }
  return found;
}

/** Nearest position where a disc of radius `r` fits entirely inside the course. */
export function clampToCourse(course: Course, x: number, y: number, r: number, accept?: (zone: Zone) => boolean): Point {
  let best: Point = { x, y };
  let bestDist = Infinity;
  for (const z of course.zones) {
    if (accept && !accept(z)) continue;
    const cx = Math.max(z.x0 + r, Math.min(z.x1 - r, x));
    const cy = Math.max(z.y0 + r, Math.min(z.y1 - r, y));
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d === 0) return { x, y };
    if (d < bestDist) {
      bestDist = d;
      best = { x: cx, y: cy };
    }
  }
  return best;
}
