import { CONFIG } from '../config';
import { PORTAL_RADIUS, type Course, type Point } from '../sim/course';
import { PLAYER, type Game, type Player } from '../sim/game';
import { bananaCapsule, bananaExtent, BANANA_TIMING, spikePhase, type Banana, type Spike } from '../sim/hazards';
import type { Projectile, Smoke } from '../sim/spells';
import { hash01 } from '../sim/rng';
import { characterTop, drawCharacter, type Pose } from './character';

/** Visual effects created from game events, in world coordinates of one phase. */
export interface Effect {
  kind: 'blink' | 'damage' | 'corpse';
  phase: number;
  x: number;
  y: number;
  toX?: number;
  toY?: number;
  text?: string;
  /** Text color (damage/heal numbers) or corpse outfit color. */
  color?: string;
  skin?: string;
  age: number;
  life: number;
}

/** Corpses fade out over this last fraction of their life. */
const CORPSE_FADE = 0.25;
/** Projectiles fly at about chest height. */
const PROJECTILE_HEIGHT = 20;

export interface DrawOptions {
  /** Team of the player at this screen: their names show white, rivals' red. */
  localTeam: number;
  /** Range of the selected spell, drawn as a faint ring around the player. */
  aimRange: number | null;
}

/** 2:1 isometric projection: world (x, y) on the ground to unscaled screen units. */
const iso = (x: number, y: number): Point => ({ x: x - y, y: (x + y) / 2 });
const fromIso = (sx: number, sy: number): Point => ({ x: sy + sx / 2, y: sy - sx / 2 });

/** A world circle of radius r is an ellipse of these radii on screen. */
const ISO_RX = Math.SQRT2;
const ISO_RY = Math.SQRT2 / 2;

const CLIFF_DEPTH = 110;
const ICICLE_SPACING = 11;
/** Character drawing units per world unit (the drawing is about 46 units tall). */
const CHARACTER_SCALE = 0.95;
/** Movement bigger than this between frames is a teleport, not walking. */
const TELEPORT_DISTANCE = 40;
const DUNGEON_WALL_HEIGHT = 150;
const DUNGEON_TILE = 60;
const BRICK_HEIGHT = 25;
const BRICK_LENGTH = 50;

const COLORS = {
  void: '#04060b',
  snow: '#e7eef5',
  snowShade: '#cfdbe7',
  snowLight: '#f9fbfe',
  rim: '#ffffff',
  cliffTop: '#a9b9ca',
  cliffMid: '#4a5a6e',
  icicle: '#e2ebf3',
  crystal: '#e9f8ff',
  crystalDeep: '#6fc3ff',
  sausage: '#d4ecff',
  sausageOutline: '#6f9fc8',
  portalOuter: '#1f7bff',
  portalInner: '#7fe3ff',
  hp: '#e0413a',
  hpBack: '#2a0d0d',
  stoneFloor: '#3f3832',
  stoneGrout: '#2b2622',
  stoneCliff: '#4d443c',
  wallTop: '#5a5048',
  wallBottom: '#2a2420',
  brickLine: 'rgba(0, 0, 0, 0.35)',
  frost: '#7fd0ff',
};

interface Edge {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  seed: number;
}

interface Speck {
  x: number;
  y: number;
  r: number;
  light: boolean;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private zoom = 1;
  private camera: Point = { x: 0, y: 0 };
  private readonly frontEdgeCache = new WeakMap<Course, Edge[]>();
  private readonly backEdgeCache = new WeakMap<Course, Edge[]>();
  private readonly speckCache = new WeakMap<Course, Speck[]>();
  private readonly poses = new Map<number, { x: number; y: number; facing: 1 | -1; walk: number }>();
  private readonly trails = new Map<number, Point[]>();
  private localTeam = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  /** CSS-pixel position on the canvas to world coordinates (using the last drawn camera). */
  screenToWorld(sx: number, sy: number): Point {
    return fromIso((sx - this.width / 2) / this.zoom + this.camera.x, (sy - this.height / 2) / this.zoom + this.camera.y);
  }

  draw(game: Game, local: Player, alpha: number, effects: Effect[], options: DrawOptions): void {
    const { ctx } = this;
    const course = game.courses[local.phase];
    const focus = lerpPos(local, alpha);
    this.camera = iso(focus.x, focus.y);
    this.localTeam = options.localTeam;
    this.updateTrails(game);

    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.fillStyle = COLORS.void;
    ctx.fillRect(0, 0, this.width, this.height);

    this.drawCliffs(course);
    this.drawFloor(course);
    if (course.theme === 'dungeon') this.drawDungeonWalls(course);

    const visible = effects.filter((e) => e.phase === local.phase);
    for (const effect of visible) if (effect.kind === 'corpse') this.drawCorpse(effect);

    const field = game.hazards[local.phase];
    for (const spike of field.spikes) this.drawSpikeGround(spike);
    for (const banana of field.bananas) this.drawBananaWarning(course, banana);
    if (local.alive && Math.hypot(local.tx - local.x, local.ty - local.y) > 6) this.drawTargetMarker(local.tx, local.ty);
    if (local.alive && options.aimRange) this.drawRangeRing(focus, options.aimRange);
    for (const p of game.players) if (p.mark && p.mark.phase === local.phase && p.phase === local.phase) this.drawMark(p, alpha);
    for (const p of game.players) {
      const caster = p.pull ? game.player(p.pull.casterId) : undefined;
      if (caster && p.phase === local.phase) this.drawChain(lerpPos(caster, alpha), lerpPos(p, alpha));
    }

    // Everything with height is drawn back to front.
    const drawables: { depth: number; draw: () => void }[] = [];
    for (const spike of field.spikes) drawables.push({ depth: spike.x + spike.y, draw: () => this.drawSpikeCrystals(spike) });
    for (const banana of field.bananas) {
      const c = bananaCapsule(course.zones[banana.zone], banana, 1);
      drawables.push({ depth: (c.ax + c.ay + c.bx + c.by) / 2, draw: () => this.drawBanana(course, banana) });
    }
    course.portals.forEach((portal, i) =>
      drawables.push({ depth: portal.x + portal.y, draw: () => this.drawPortal(portal, game.tick, i) }),
    );
    for (const p of game.players) {
      if (p.phase !== local.phase || !p.alive) continue;
      const pos = lerpPos(p, alpha);
      drawables.push({ depth: pos.x + pos.y, draw: () => this.drawPlayer(p, pos, game.tick) });
    }
    for (const proj of game.projectiles) {
      if (proj.phase !== local.phase) continue;
      const pos = { x: proj.px + (proj.x - proj.px) * alpha, y: proj.py + (proj.y - proj.py) * alpha };
      const owner = game.player(proj.ownerId);
      drawables.push({
        depth: pos.x + pos.y,
        draw: () => this.drawProjectile(proj, pos, owner ? lerpPos(owner, alpha) : null, game.tick),
      });
    }
    drawables.sort((a, b) => a.depth - b.depth);
    for (const d of drawables) d.draw();

    for (const smoke of game.smokes) if (smoke.phase === local.phase) this.drawSmoke(smoke, game.tick);
    for (const effect of visible) if (effect.kind !== 'corpse') this.drawEffect(effect);
    if (local.alive && local.blindTicks > 0) {
      this.drawBlindness(focus);
      // Blind players still see themselves: drawn again over the smoke and the darkness.
      this.drawPlayer(local, focus, game.tick);
    }
  }

  // --- Spells ---

  /** Remembers where each marked player walked, to draw the trail back to the X. */
  private updateTrails(game: Game): void {
    for (const p of game.players) {
      if (!p.mark) {
        this.trails.delete(p.id);
        continue;
      }
      const trail = this.trails.get(p.id) ?? [{ x: p.mark.x, y: p.mark.y }];
      const last = trail[trail.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 8) trail.push({ x: p.x, y: p.y });
      this.trails.set(p.id, trail);
    }
  }

  private drawRangeRing(center: Point, range: number): void {
    const s = this.toScreen(center.x, center.y);
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, range * ISO_RX * this.zoom, range * ISO_RY * this.zoom, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Red X where the mark hit, and dashes along the path the victim walked since. */
  private drawMark(p: Player, alpha: number): void {
    const { ctx } = this;
    const mark = p.mark!;
    const x = this.toScreen(mark.x, mark.y);
    const size = 12 * this.zoom;
    ctx.save();
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#ff3b30';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(x.x - size, x.y - size * 0.5);
    ctx.lineTo(x.x + size, x.y + size * 0.5);
    ctx.moveTo(x.x + size, x.y - size * 0.5);
    ctx.lineTo(x.x - size, x.y + size * 0.5);
    ctx.stroke();

    const trail = [...(this.trails.get(p.id) ?? []), lerpPos(p, alpha)];
    ctx.shadowBlur = 0;
    ctx.setLineDash([5, 7]);
    ctx.strokeStyle = 'rgba(255, 90, 80, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    trail.forEach((point, i) => {
      const s = this.toScreen(point.x, point.y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  private drawChain(from: Point, to: Point): void {
    const a = this.toScreen(from.x, from.y);
    const b = this.toScreen(to.x, to.y);
    const lift = PROJECTILE_HEIGHT * this.zoom;
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#c9ced6';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - lift);
    ctx.lineTo(b.x, b.y - lift);
    ctx.stroke();
    ctx.restore();
  }

  private drawProjectile(proj: Projectile, pos: Point, owner: Point | null, tick: number): void {
    const { ctx } = this;
    const z = this.zoom;
    const s = this.toScreen(pos.x, pos.y);
    const y = s.y - PROJECTILE_HEIGHT * z;

    // Shadow on the ground.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, proj.radius * ISO_RX * z * 0.7, proj.radius * ISO_RY * z * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    switch (proj.kind) {
      case 'fire': {
        const r = proj.radius * z;
        const glow = ctx.createRadialGradient(s.x, y, 0, s.x, y, r * 1.8);
        glow.addColorStop(0, '#fff6c2');
        glow.addColorStop(0.35, '#ffb02e');
        glow.addColorStop(0.75, 'rgba(230, 70, 20, 0.85)');
        glow.addColorStop(1, 'rgba(230, 70, 20, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(s.x, y, r * 1.8, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'gust': {
        const r = proj.radius * z;
        ctx.strokeStyle = 'rgba(220, 245, 255, 0.9)';
        ctx.lineWidth = 3;
        const spin = tick * 0.4;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(s.x, y, r * (0.5 + i * 0.3), r * (0.3 + i * 0.18), 0, spin + i * 2, spin + i * 2 + 3.6);
          ctx.stroke();
        }
        break;
      }
      case 'hook': {
        if (owner) this.drawChain(owner, pos);
        ctx.strokeStyle = '#e4e8ee';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(s.x, y, proj.radius * z * 0.8, 0.3, Math.PI * 1.4);
        ctx.stroke();
        break;
      }
      case 'mark': {
        const r = proj.radius * z;
        ctx.fillStyle = '#ff3b30';
        ctx.shadowColor = '#ff3b30';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(s.x, y, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x - r * 0.4, y - r * 0.4);
        ctx.lineTo(s.x + r * 0.4, y + r * 0.4);
        ctx.moveTo(s.x + r * 0.4, y - r * 0.4);
        ctx.lineTo(s.x - r * 0.4, y + r * 0.4);
        ctx.stroke();
        break;
      }
      case 'smoke':
        ctx.fillStyle = '#1a1a1e';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.arc(s.x, y, proj.radius * z, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
    }
    ctx.restore();
  }

  /** Billowing black cloud, fading in quickly and out at the end. */
  private drawSmoke(smoke: Smoke, tick: number): void {
    const { ctx } = this;
    const center = this.toScreen(smoke.x, smoke.y);
    const r = smoke.radius * this.zoom;
    if (this.offscreen([center.x - r * 2, center.x + r * 2], [center.y - r * 2, center.y + r])) return;
    const age = smoke.totalTicks - smoke.ticksLeft;
    const alpha = Math.min(1, age / 10, smoke.ticksLeft / 30) * 0.85;
    for (let i = 0; i < 9; i++) {
      const angle = hash01(smoke.id, i) * Math.PI * 2 + tick * 0.004 * (i % 2 ? 1 : -1);
      const dist = Math.sqrt(hash01(smoke.id, i + 10)) * smoke.radius * 0.7;
      const puff = this.toScreen(smoke.x + Math.cos(angle) * dist, smoke.y + Math.sin(angle) * dist);
      const pr = (0.45 + 0.35 * hash01(smoke.id, i + 20)) * r;
      const py = puff.y - pr * 0.6;
      const g = ctx.createRadialGradient(puff.x, py, 0, puff.x, py, pr * 1.3);
      g.addColorStop(0, `rgba(20, 20, 24, ${alpha})`);
      g.addColorStop(0.7, `rgba(30, 30, 36, ${alpha * 0.8})`);
      g.addColorStop(1, 'rgba(30, 30, 36, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(puff.x, py, pr * 1.3 * ISO_RX * 0.8, pr * 1.3 * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Blinded by smoke: everything goes black except a small circle around your own character. */
  private drawBlindness(center: Point): void {
    const s = this.toScreen(center.x, center.y);
    const y = s.y - 20 * this.zoom;
    const inner = 45 * this.zoom;
    const outer = 85 * this.zoom;
    const { ctx } = this;
    const dark = ctx.createRadialGradient(s.x, y, inner, s.x, y, outer);
    dark.addColorStop(0, 'rgba(0, 0, 0, 0)');
    dark.addColorStop(1, 'rgba(0, 0, 0, 0.97)');
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * devicePixelRatio);
    this.canvas.height = Math.round(this.height * devicePixelRatio);
    this.zoom = Math.max(0.6, Math.min(1.6, Math.min(this.width, this.height) / 620));
  }

  private toScreen(x: number, y: number): Point {
    const p = iso(x, y);
    return {
      x: (p.x - this.camera.x) * this.zoom + this.width / 2,
      y: (p.y - this.camera.y) * this.zoom + this.height / 2,
    };
  }

  private offscreen(xs: number[], ys: number[], margin = 0): boolean {
    return (
      Math.max(...xs) < -margin ||
      Math.min(...xs) > this.width + margin ||
      Math.max(...ys) < -margin ||
      Math.min(...ys) > this.height + margin
    );
  }

  // --- Course ---

  private drawCliffs(course: Course): void {
    const { ctx } = this;
    const ice = course.theme === 'ice';
    const depth = CLIFF_DEPTH * this.zoom;
    for (const edge of this.frontEdges(course)) {
      const a = this.toScreen(edge.ax, edge.ay);
      const b = this.toScreen(edge.bx, edge.by);
      if (this.offscreen([a.x, b.x], [a.y, b.y + depth, a.y + depth])) continue;

      const top = Math.min(a.y, b.y);
      const face = ctx.createLinearGradient(0, top, 0, top + depth + Math.abs(a.y - b.y));
      face.addColorStop(0, ice ? COLORS.cliffTop : COLORS.stoneCliff);
      face.addColorStop(0.4, ice ? COLORS.cliffMid : COLORS.wallBottom);
      face.addColorStop(1, COLORS.void);
      ctx.fillStyle = face;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x, b.y + depth);
      ctx.lineTo(a.x, a.y + depth);
      ctx.closePath();
      ctx.fill();
      if (!ice) continue;

      // Icicles hanging from the rim, like the frozen cliffs in DarkEden.
      const length = Math.hypot(edge.bx - edge.ax, edge.by - edge.ay);
      const count = Math.max(1, Math.floor(length / ICICLE_SPACING));
      const icicles = ctx.createLinearGradient(0, top, 0, top + depth * 1.1);
      icicles.addColorStop(0, COLORS.icicle);
      icicles.addColorStop(1, 'rgba(160, 190, 220, 0)');
      ctx.fillStyle = icicles;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const p0 = lerp(a, b, i / count);
        const p1 = lerp(a, b, (i + 1) / count);
        const tipLength = (0.15 + 0.85 * hash01(edge.seed, i) ** 2) * depth;
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2 + tipLength);
        ctx.closePath();
      }
      ctx.fill();
    }
  }

  private drawFloor(course: Course): void {
    const { ctx } = this;
    const ice = course.theme === 'ice';
    ctx.fillStyle = ice ? COLORS.snow : COLORS.stoneFloor;
    for (const z of course.zones) {
      const corners = [this.toScreen(z.x0, z.y0), this.toScreen(z.x1, z.y0), this.toScreen(z.x1, z.y1), this.toScreen(z.x0, z.y1)];
      if (this.offscreen(corners.map((c) => c.x), corners.map((c) => c.y))) continue;
      ctx.beginPath();
      corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
      ctx.closePath();
      ctx.fill();
    }

    if (ice) {
      for (const speck of this.specks(course)) {
        const s = this.toScreen(speck.x, speck.y);
        if (s.x < -20 || s.x > this.width + 20 || s.y < -20 || s.y > this.height + 20) continue;
        ctx.fillStyle = speck.light ? COLORS.snowLight : COLORS.snowShade;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, speck.r * ISO_RX * this.zoom, speck.r * ISO_RY * this.zoom, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      this.drawFloorTiles(course);
    }

    ctx.strokeStyle = ice ? COLORS.rim : COLORS.wallTop;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const edge of this.frontEdges(course)) {
      const a = this.toScreen(edge.ax, edge.ay);
      const b = this.toScreen(edge.bx, edge.by);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  /** Stone tile grout lines, aligned to a world grid so overlapping rooms line up. */
  private drawFloorTiles(course: Course): void {
    const { ctx } = this;
    ctx.strokeStyle = COLORS.stoneGrout;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const z of course.zones) {
      for (let x = Math.ceil(z.x0 / DUNGEON_TILE) * DUNGEON_TILE; x < z.x1; x += DUNGEON_TILE) {
        const a = this.toScreen(x, z.y0);
        const b = this.toScreen(x, z.y1);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      for (let y = Math.ceil(z.y0 / DUNGEON_TILE) * DUNGEON_TILE; y < z.y1; y += DUNGEON_TILE) {
        const a = this.toScreen(z.x0, y);
        const b = this.toScreen(z.x1, y);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();
  }

  /** Brick walls rising from the far (north and west) edges of the dungeon. */
  private drawDungeonWalls(course: Course): void {
    const { ctx } = this;
    const height = DUNGEON_WALL_HEIGHT * this.zoom;
    for (const edge of this.backEdges(course)) {
      const a = this.toScreen(edge.ax, edge.ay);
      const b = this.toScreen(edge.bx, edge.by);
      if (this.offscreen([a.x, b.x], [a.y, b.y, a.y - height])) continue;

      const top = Math.min(a.y, b.y) - height;
      const face = ctx.createLinearGradient(0, top, 0, Math.max(a.y, b.y));
      face.addColorStop(0, COLORS.wallTop);
      face.addColorStop(1, COLORS.wallBottom);
      ctx.fillStyle = face;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x, b.y - height);
      ctx.lineTo(a.x, a.y - height);
      ctx.closePath();
      ctx.fill();

      // Brick courses: horizontal rows plus staggered vertical joints.
      const length = Math.hypot(edge.bx - edge.ax, edge.by - edge.ay);
      const rows = Math.round(DUNGEON_WALL_HEIGHT / BRICK_HEIGHT);
      const bricks = Math.max(1, Math.round(length / BRICK_LENGTH));
      ctx.strokeStyle = COLORS.brickLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let r = 1; r < rows; r++) {
        const lift = (r * height) / rows;
        ctx.moveTo(a.x, a.y - lift);
        ctx.lineTo(b.x, b.y - lift);
      }
      for (let r = 0; r < rows; r++) {
        const y0 = (r * height) / rows;
        const y1 = ((r + 1) * height) / rows;
        for (let i = r % 2 === 0 ? 1 : 0.5; i < bricks; i++) {
          const p = lerp(a, b, i / bricks);
          ctx.moveTo(p.x, p.y - y0);
          ctx.lineTo(p.x, p.y - y1);
        }
      }
      ctx.stroke();

      ctx.strokeStyle = COLORS.wallTop;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - height);
      ctx.lineTo(b.x, b.y - height);
      ctx.stroke();
    }
  }

  /** Floor edges facing the camera (south and east sides) that aren't covered by another zone. */
  private frontEdges(course: Course): Edge[] {
    let edges = this.frontEdgeCache.get(course);
    if (!edges) {
      edges = outlineEdges(course, 'front');
      this.frontEdgeCache.set(course, edges);
    }
    return edges;
  }

  /** Floor edges facing away from the camera (north and west sides). */
  private backEdges(course: Course): Edge[] {
    let edges = this.backEdgeCache.get(course);
    if (!edges) {
      edges = outlineEdges(course, 'back');
      this.backEdgeCache.set(course, edges);
    }
    return edges;
  }

  private specks(course: Course): Speck[] {
    let specks = this.speckCache.get(course);
    if (specks) return specks;
    specks = [];
    for (const z of course.zones) {
      const count = Math.floor(((z.x1 - z.x0) * (z.y1 - z.y0)) / 2600);
      for (let i = 0; i < count; i++) {
        specks.push({
          x: z.x0 + 8 + hash01(z.index * 977 + i, 1) * (z.x1 - z.x0 - 16),
          y: z.y0 + 8 + hash01(z.index * 977 + i, 2) * (z.y1 - z.y0 - 16),
          r: 2 + hash01(z.index * 977 + i, 3) * 7,
          light: hash01(z.index * 977 + i, 4) < 0.35,
        });
      }
    }
    this.speckCache.set(course, specks);
    return specks;
  }

  // --- Obstacles ---

  /** Blue swirling circle warning where ice is about to come out. */
  private drawSpikeGround(spike: Spike): void {
    const { phase, progress } = spikePhase(spike);
    const s = this.toScreen(spike.x, spike.y);
    const rx = spike.radius * ISO_RX * this.zoom;
    const ry = spike.radius * ISO_RY * this.zoom;
    if (this.offscreen([s.x - rx, s.x + rx], [s.y - ry, s.y + ry], 40)) return;
    const { ctx } = this;
    const intensity = phase === 'warn' ? 0.35 + 0.65 * progress : phase === 'active' ? 1 : 1 - progress;

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(1, ry / rx);
    const glow = ctx.createRadialGradient(0, 0, rx * 0.1, 0, 0, rx);
    glow.addColorStop(0, `rgba(191, 233, 255, ${0.55 * intensity})`);
    glow.addColorStop(0.7, `rgba(71, 182, 255, ${0.45 * intensity})`);
    glow.addColorStop(1, 'rgba(31, 123, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();

    if (phase === 'warn') {
      ctx.strokeStyle = `rgba(120, 210, 255, ${0.9 * intensity})`;
      ctx.lineWidth = 2.5 / (ry / rx);
      const spin = spike.age * 0.12;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, rx * (0.45 + 0.18 * i) * progress, spin + i * 2.1, spin + i * 2.1 + 1.6);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawSpikeCrystals(spike: Spike): void {
    const { phase, progress } = spikePhase(spike);
    if (phase === 'warn') return;
    const growth = phase === 'active' ? Math.min(1, progress * 3) : 1 - progress;
    if (growth <= 0) return;
    const { ctx } = this;

    const shards = Array.from({ length: 7 }, (_, k) => {
      const angle = hash01(spike.id, k) * Math.PI * 2;
      const dist = Math.sqrt(hash01(spike.id, k + 20)) * spike.radius * 0.65;
      return {
        x: spike.x + Math.cos(angle) * dist,
        y: spike.y + Math.sin(angle) * dist,
        height: (0.7 + 0.6 * hash01(spike.id, k + 40)) * spike.radius * 1.5,
        width: (0.25 + 0.15 * hash01(spike.id, k + 60)) * spike.radius,
        lean: (hash01(spike.id, k + 80) - 0.5) * 0.5,
      };
    }).sort((a, b) => a.x + a.y - (b.x + b.y));

    ctx.globalAlpha = phase === 'fade' ? 1 - progress : 1;
    for (const shard of shards) {
      const base = this.toScreen(shard.x, shard.y);
      const h = shard.height * growth * this.zoom;
      const w = shard.width * this.zoom;
      const tip = { x: base.x + shard.lean * h, y: base.y - h };
      const fill = ctx.createLinearGradient(0, tip.y, 0, base.y);
      fill.addColorStop(0, COLORS.crystal);
      fill.addColorStop(1, COLORS.crystalDeep);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(base.x - w, base.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.lineTo(base.x + w, base.y);
      ctx.lineTo(base.x, base.y + w * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Glowing spot on the wall before a sausage comes out. */
  private drawBananaWarning(course: Course, banana: Banana): void {
    if (banana.age >= BANANA_TIMING.warn) return;
    const c = bananaCapsule(course.zones[banana.zone], banana, 0);
    const s = this.toScreen(c.ax, c.ay);
    const pulse = 0.4 + 0.6 * Math.abs(Math.sin(banana.age * 0.25));
    const r = 26 * this.zoom;
    const glow = this.ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
    glow.addColorStop(0, `rgba(191, 233, 255, ${pulse})`);
    glow.addColorStop(1, 'rgba(71, 182, 255, 0)');
    this.ctx.fillStyle = glow;
    this.ctx.beginPath();
    this.ctx.ellipse(s.x, s.y, r * ISO_RX, r * ISO_RY * 1.4, 0, 0, Math.PI * 2);
    this.ctx.fill();
  }

  /**
   * Sausage of ice: a horizontal tube resting on the floor, drawn as a thick rounded
   * stroke (outline, body, highlight) over a soft shadow.
   */
  private drawBanana(course: Course, banana: Banana): void {
    const extent = bananaExtent(banana);
    if (extent <= 0) return;
    const c = bananaCapsule(course.zones[banana.zone], banana, extent);
    const { ctx } = this;
    const r = c.radius * this.zoom;
    const groundA = this.toScreen(c.ax, c.ay);
    const groundB = this.toScreen(c.bx, c.by);
    const a = { x: groundA.x, y: groundA.y - r };
    const b = { x: groundB.x, y: groundB.y - r };

    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = r * 2;
    line(ctx, groundA, groundB);
    ctx.strokeStyle = COLORS.sausageOutline;
    ctx.lineWidth = r * 2 + 3;
    line(ctx, a, b);
    ctx.strokeStyle = COLORS.sausage;
    ctx.lineWidth = r * 2;
    line(ctx, a, b);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = r * 0.45;
    line(ctx, { x: a.x, y: a.y - r * 0.45 }, { x: b.x, y: b.y - r * 0.45 });
    ctx.lineCap = 'butt';
  }

  private drawPortal(portal: Point, tick: number, index: number): void {
    const s = this.toScreen(portal.x, portal.y);
    const rx = PORTAL_RADIUS * ISO_RX * this.zoom;
    const ry = PORTAL_RADIUS * ISO_RY * this.zoom;
    if (this.offscreen([s.x - rx, s.x + rx], [s.y - ry * 4, s.y + ry], 20)) return;
    const { ctx } = this;

    ctx.save();
    ctx.translate(s.x, s.y);
    const column = ctx.createLinearGradient(0, -ry * 5, 0, 0);
    column.addColorStop(0, 'rgba(127, 227, 255, 0)');
    column.addColorStop(1, 'rgba(127, 227, 255, 0.25)');
    ctx.fillStyle = column;
    ctx.fillRect(-rx * 0.6, -ry * 5, rx * 1.2, ry * 5);

    ctx.scale(1, ry / rx);
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    core.addColorStop(0, '#0b1e4a');
    core.addColorStop(0.55, COLORS.portalOuter);
    core.addColorStop(0.85, COLORS.portalInner);
    core.addColorStop(1, 'rgba(127, 227, 255, 0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 3;
    const spin = tick * 0.08 + index;
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(191, 240, 255, 0.85)' : 'rgba(31, 123, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(0, 0, rx * (0.35 + 0.15 * i), spin + i * 1.7, spin + i * 1.7 + 2.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- Players and effects ---

  /**
   * Facing and walk cycle from how the player moved since the last frame. The cycle advances
   * half a turn per footstep distance, so the legs match the footstep sounds.
   */
  private poseFor(p: Player, pos: Point): Pose {
    let state = this.poses.get(p.id);
    if (!state) {
      state = { x: pos.x, y: pos.y, facing: -1, walk: 0 };
      this.poses.set(p.id, state);
    }
    const dx = pos.x - state.x;
    const dy = pos.y - state.y;
    const dist = Math.hypot(dx, dy);
    state.x = pos.x;
    state.y = pos.y;
    // Teleports (Blink, portals, respawn) and shoves aren't steps.
    const walking = dist > 0.05 && dist < TELEPORT_DISTANCE && p.kbx === 0 && p.kby === 0;
    if (walking) {
      state.walk += (dist * Math.PI) / CONFIG.audio.footsteps.stepDistance;
      const screenDx = dx - dy;
      if (Math.abs(screenDx) > 0.05) state.facing = screenDx > 0 ? 1 : -1;
    }
    return { facing: state.facing, walk: state.walk, moving: walking };
  }

  private drawPlayer(p: Player, pos: Point, tick: number): void {
    const { ctx } = this;
    const s = this.toScreen(pos.x, pos.y);
    const z = this.zoom;
    const r = PLAYER.radius * z;
    // Blink while invulnerable after a hit or respawn.
    if (p.invulnTicks > 0 && Math.floor(tick / 5) % 2 === 0) ctx.globalAlpha = 0.45;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r * ISO_RX * 0.9, r * ISO_RY * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();

    // Frost ring while slowed.
    if (p.slowTicks > 0) {
      ctx.strokeStyle = COLORS.frost;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, r * ISO_RX * 1.3, r * ISO_RY * 1.3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const unit = CHARACTER_SCALE * z;
    drawCharacter(ctx, s.x, s.y, unit, p.appearance, this.poseFor(p, pos));
    ctx.globalAlpha = 1;

    const barW = 40 * z;
    const barY = s.y - characterTop(p.appearance) * unit - 8 * z;
    ctx.fillStyle = COLORS.hpBack;
    ctx.fillRect(s.x - barW / 2, barY, barW, 4 * z);
    ctx.fillStyle = COLORS.hp;
    ctx.fillRect(s.x - barW / 2, barY, (barW * p.hp) / PLAYER.maxHp, 4 * z);

    ctx.font = `${Math.round(11 * z)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = p.team === this.localTeam ? '#ffffff' : '#ff8a7a';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 3;
    ctx.strokeText(p.name, s.x, barY - 4 * z);
    ctx.fillText(p.name, s.x, barY - 4 * z);
  }

  /** Body lying where the player died, over a dark stain, fading out at the end. */
  private drawCorpse(effect: Effect): void {
    const { ctx } = this;
    const z = this.zoom;
    const center = this.toScreen(effect.x, effect.y);
    if (this.offscreen([center.x], [center.y], 80)) return;
    const t = effect.age / effect.life;
    ctx.globalAlpha = t < 1 - CORPSE_FADE ? 1 : (1 - t) / CORPSE_FADE;

    // Stain grows a little during the first second.
    const spread = Math.min(1, effect.age / 60);
    const stain = PLAYER.radius * (1.2 + 0.8 * spread) * z;
    ctx.fillStyle = 'rgba(70, 8, 12, 0.55)';
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, stain * ISO_RX, stain * ISO_RY, 0, 0, Math.PI * 2);
    ctx.fill();

    // The body lies along a direction picked from where it fell, so each corpse looks different.
    const angle = hash01(Math.round(effect.x), Math.round(effect.y)) * Math.PI * 2;
    const half = 16;
    const head = this.toScreen(effect.x + Math.cos(angle) * half, effect.y + Math.sin(angle) * half);
    const feet = this.toScreen(effect.x - Math.cos(angle) * half, effect.y - Math.sin(angle) * half);
    const lift = 4 * z;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 16 * z + 3;
    line(ctx, { x: feet.x, y: feet.y - lift }, { x: head.x, y: head.y - lift });
    ctx.strokeStyle = effect.color ?? '#888888';
    ctx.lineWidth = 16 * z;
    line(ctx, { x: feet.x, y: feet.y - lift }, { x: head.x, y: head.y - lift });
    ctx.lineCap = 'butt';

    ctx.fillStyle = effect.skin ?? '#d9bea3';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(head.x, head.y - lift, 7 * z, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawTargetMarker(x: number, y: number): void {
    const s = this.toScreen(x, y);
    const r = 10 * this.zoom;
    this.ctx.strokeStyle = 'rgba(255, 215, 90, 0.9)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.ellipse(s.x, s.y, r * ISO_RX, r * ISO_RY, 0, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  private drawEffect(effect: Effect): void {
    const { ctx } = this;
    const t = effect.age / effect.life;
    if (effect.kind === 'blink') {
      for (const [x, y] of [
        [effect.x, effect.y],
        [effect.toX ?? effect.x, effect.toY ?? effect.y],
      ]) {
        const s = this.toScreen(x, y);
        const r = (18 + 30 * t) * this.zoom;
        ctx.strokeStyle = `rgba(150, 220, 255, ${1 - t})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y - 16 * this.zoom, r * ISO_RX, r * ISO_RY, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      return;
    }
    const s = this.toScreen(effect.x, effect.y);
    ctx.globalAlpha = 1 - t;
    ctx.font = `bold ${Math.round(16 * this.zoom)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = effect.color ?? '#ff5a4f';
    const y = s.y - (60 + 40 * t) * this.zoom;
    ctx.strokeText(effect.text ?? '', s.x, y);
    ctx.fillText(effect.text ?? '', s.x, y);
    ctx.globalAlpha = 1;
  }
}

/** Minimap of the current phase, like the one in the corner of DarkEden. */
export function drawMinimap(canvas: HTMLCanvasElement, game: Game, local: Player): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  const course = game.courses[local.phase];
  ctx.clearRect(0, 0, w, h);

  const corners = course.zones.flatMap((z) => [iso(z.x0, z.y0), iso(z.x1, z.y0), iso(z.x1, z.y1), iso(z.x0, z.y1)]);
  const minX = Math.min(...corners.map((c) => c.x));
  const maxX = Math.max(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxY = Math.max(...corners.map((c) => c.y));
  const scale = Math.min((w - 16) / (maxX - minX), (h - 16) / (maxY - minY));
  const map = (x: number, y: number): Point => {
    const p = iso(x, y);
    return { x: 8 + (p.x - minX) * scale + (w - 16 - (maxX - minX) * scale) / 2, y: 8 + (p.y - minY) * scale };
  };

  ctx.fillStyle = course.theme === 'ice' ? '#dfe8f1' : '#7a6e64';
  for (const z of course.zones) fillPolygon(ctx, [map(z.x0, z.y0), map(z.x1, z.y0), map(z.x1, z.y1), map(z.x0, z.y1)]);
  ctx.fillStyle = '#2f8cff';
  for (const portal of course.portals) {
    const p = map(portal.x, portal.y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const p of game.players) {
    if (p.phase !== local.phase || !p.alive) continue;
    const m = map(p.x, p.y);
    ctx.fillStyle = p.id === local.id ? '#ff3b30' : p.appearance.outfit;
    ctx.beginPath();
    ctx.arc(m.x, m.y, p.id === local.id ? 3.5 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Outline edges of the course (the union of its zones) not covered by another zone:
 * 'front' = south and east sides (cliffs face the camera), 'back' = north and west sides.
 */
function outlineEdges(course: Course, which: 'front' | 'back'): Edge[] {
  const edges: Edge[] = [];
  for (const z of course.zones) {
    const others = course.zones.filter((o) => o !== z);
    // Horizontal edge (constant y) and vertical edge (constant x) on the requested side.
    const ey = which === 'front' ? z.y1 : z.y0;
    const ex = which === 'front' ? z.x1 : z.x0;
    const beyondY = (o: (typeof others)[number]) => (which === 'front' ? o.y0 <= ey && ey < o.y1 : o.y0 < ey && ey <= o.y1);
    const beyondX = (o: (typeof others)[number]) => (which === 'front' ? o.x0 <= ex && ex < o.x1 : o.x0 < ex && ex <= o.x1);

    for (const [from, to] of uncovered(z.x0, z.x1, others.filter(beyondY).map((o): [number, number] => [o.x0, o.x1]))) {
      edges.push({ ax: from, ay: ey, bx: to, by: ey, seed: Math.round(from * 7 + ey * 13) });
    }
    for (const [from, to] of uncovered(z.y0, z.y1, others.filter(beyondX).map((o): [number, number] => [o.y0, o.y1]))) {
      edges.push({ ax: ex, ay: from, bx: ex, by: to, seed: Math.round(ex * 17 + from * 19) });
    }
  }
  return edges;
}

function lerpPos(p: Player, alpha: number): Point {
  return { x: p.px + (p.x - p.px) * alpha, y: p.py + (p.y - p.py) * alpha };
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function line(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function fillPolygon(ctx: CanvasRenderingContext2D, points: Point[]): void {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
}

/** Parts of [start, end] not covered by any of the given intervals. */
function uncovered(start: number, end: number, covers: [number, number][]): [number, number][] {
  let parts: [number, number][] = [[start, end]];
  for (const [c0, c1] of covers) {
    parts = parts.flatMap(([a, b]): [number, number][] => {
      if (c1 <= a || c0 >= b) return [[a, b]];
      const out: [number, number][] = [];
      if (c0 > a) out.push([a, c0]);
      if (c1 < b) out.push([c1, b]);
      return out;
    });
  }
  return parts.filter(([a, b]) => b - a > 1);
}
