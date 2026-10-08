import type { Appearance, Beard, Headwear } from '../appearance';

/** Facing and walk cycle used to animate a character. */
export interface Pose {
  /** 1 = facing right on screen, -1 = left. */
  facing: 1 | -1;
  /** Walk cycle in radians; legs and arms swing with its sine. */
  walk: number;
  moving: boolean;
}

/** Height above the feet (in character units) where the name and HP bar can go without overlapping. */
export function characterTop(look: Appearance): number {
  const extra: Record<Headwear, number> = { none: 0, hood: 3, wizard: 18, helmet: 2, bandana: 0, crown: 6 };
  return 46 + extra[look.headwear];
}

const OUTLINE = 'rgba(0, 0, 0, 0.75)';
const BOOTS = '#3b2a1c';
const BELT = '#3b2a1c';
const GOLD = '#d6b25a';
const CROWN = '#e8c45a';
const STEEL = '#9aa3ad';
const STEEL_DARK = '#5f6770';
const WOOD = '#6b4423';
const WIZARD_HAT = '#3d2f73';
const ORB = '#7fe3ff';
/** Eye positions on the three-quarter face (the near one is toward the facing side). */
const NEAR_EYE_X = 3.7;
const FAR_EYE_X = -0.3;

interface Frame {
  look: Appearance;
  swing: number;
  bob: number;
  headY: number;
  armX: number;
  legX: number;
  feminine: boolean;
  outfitDark: string;
  outfitLight: string;
}

/**
 * Draws a character standing on (x, y), `unit` pixels per character unit (about 46 units tall).
 * Everything is drawn in a local frame mirrored by `facing`, so one drawing covers both sides.
 */
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  unit: number,
  look: Appearance,
  pose: Pose,
): void {
  const feminine = look.body === 'feminine';
  const bob = pose.moving ? Math.abs(Math.sin(pose.walk)) * 1.5 : 0;
  const f: Frame = {
    look,
    swing: pose.moving ? Math.sin(pose.walk) : 0,
    bob,
    headY: -36 - bob,
    // Narrower shoulders and closer legs on the feminine body.
    armX: feminine ? 6.6 : 7.5,
    legX: feminine ? 2.7 : 3.2,
    feminine,
    outfitDark: shade(look.outfit, -0.35),
    outfitLight: shade(look.outfit, 0.25),
  };

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pose.facing * unit, unit);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  resetStroke(ctx);

  drawBehind(ctx, f);
  drawLegs(ctx, f);
  drawArm(ctx, f, -1, f.outfitDark);
  drawTorso(ctx, f);
  if (look.weapon === 'staff') drawStaff(ctx, f);
  drawArm(ctx, f, 1, look.outfit);
  drawHead(ctx, f);
  ctx.restore();
}

// --- Layers, back to front ---

function drawBehind(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { look, swing, bob, headY } = f;
  const hideHair = look.headwear === 'hood' || look.headwear === 'helmet';

  if (look.cape) {
    const flutter = swing * 1.5;
    ctx.fillStyle = look.accent;
    path(ctx, [
      [-7, -29 - bob],
      [7, -29 - bob],
      [10 + flutter, -5],
      [-11 + flutter, -4],
    ]);
    ctx.fill();
    ctx.stroke();
  }

  if (look.weapon === 'bow') {
    // Bow slung on the back: the curve bulges out behind the body, the top tip near the head.
    const cx = 2;
    const cy = -24 - bob;
    const r = 17;
    const spread = 1.25;
    ctx.strokeStyle = '#e8e0c8';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(cx + r * Math.cos(Math.PI - spread), cy + r * Math.sin(Math.PI - spread));
    ctx.lineTo(cx + r * Math.cos(Math.PI + spread), cy + r * Math.sin(Math.PI + spread));
    ctx.stroke();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI - spread, Math.PI + spread);
    ctx.stroke();
    ctx.strokeStyle = WOOD;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    resetStroke(ctx);
  }

  if (look.weapon === 'sword') {
    // Blade across the back, hilt sticking out over the shoulder.
    ctx.strokeStyle = STEEL;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-7.2, -38.6 - bob);
    ctx.lineTo(5, -11 - bob);
    ctx.stroke();
    ctx.strokeStyle = WOOD;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-9.6, -43 - bob);
    ctx.lineTo(-7.6, -39.4 - bob);
    ctx.stroke();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-9.6, -37.4 - bob);
    ctx.lineTo(-5.4, -39.8 - bob);
    ctx.stroke();
    resetStroke(ctx);
  }

  if (look.headwear === 'hood') {
    ctx.fillStyle = f.outfitDark;
    circle(ctx, -0.5, headY, 9.3);
    ctx.fill();
    ctx.stroke();
  }
  if (hideHair) return;

  ctx.fillStyle = look.hair;
  if (look.hairStyle === 'long') {
    ctx.beginPath();
    ctx.roundRect(-7.5, headY - 4, 11, 16, 4);
    ctx.fill();
    ctx.stroke();
  } else if (look.hairStyle === 'ponytail') {
    ctx.beginPath();
    ctx.ellipse(-8.5, headY + 3 + swing * 0.8, 2.6, 6, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (look.hairStyle === 'braid') {
    // Chain of knots hanging from the back of the head, swaying a little.
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = look.hair;
      ctx.beginPath();
      ctx.ellipse(-7 - k * 0.3 + swing * 0.4 * (k / 4), headY + 3 + k * 3.2, 2.3, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = look.accent;
    ctx.fillRect(-9.2 + swing * 0.4, headY + 17.4, 3.6, 1.6);
  }
}

function drawLegs(ctx: CanvasRenderingContext2D, f: Frame): void {
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * f.legX, -13 - f.bob);
    ctx.rotate(side * f.swing * 0.35);
    ctx.fillStyle = f.look.pants;
    ctx.fillRect(-2.2, 0, 4.4, 10.5);
    ctx.strokeRect(-2.2, 0, 4.4, 10.5);
    ctx.fillStyle = BOOTS;
    ctx.beginPath();
    ctx.roundRect(-2.6, 9, 6, 4, 1.2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawTorso(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { bob, swing } = f;
  const torso = ctx.createLinearGradient(-8, 0, 8, 0);
  torso.addColorStop(0, f.outfitLight);
  torso.addColorStop(1, f.outfitDark);
  ctx.fillStyle = torso;

  if (f.feminine) {
    // Fitted at the waist, flaring into a short skirt over the hips.
    const top = -29 - bob;
    ctx.beginPath();
    ctx.moveTo(-6.8, top + 2.5);
    ctx.quadraticCurveTo(-6.8, top, -4.3, top);
    ctx.lineTo(4.3, top);
    ctx.quadraticCurveTo(6.8, top, 6.8, top + 2.5);
    ctx.quadraticCurveTo(5, top + 7, 5.2, top + 9.5);
    ctx.lineTo(9 + swing * 0.6, -9.5 - bob);
    ctx.quadraticCurveTo(0, -7.5 - bob, -9 + swing * 0.6, -9.5 - bob);
    ctx.lineTo(-5.2, top + 9.5);
    ctx.quadraticCurveTo(-5, top + 7, -6.8, top + 2.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = BELT;
    ctx.fillRect(-5.4, top + 8.6, 10.8, 2.2);
    ctx.fillStyle = GOLD;
    ctx.fillRect(1.2, top + 8.4, 2.6, 2.6);
    return;
  }
  ctx.beginPath();
  ctx.roundRect(-8, -29 - bob, 16, 17.5, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = BELT;
  ctx.fillRect(-8, -16.5 - bob, 16, 2.6);
  ctx.fillStyle = GOLD;
  ctx.fillRect(1.5, -16.8 - bob, 3, 3.2);
}

/** Shoulder pivot and rotation of an arm; arms swing opposite to the leg on the same side. */
function armAngle(f: Frame, side: -1 | 1): number {
  return -side * f.swing * 0.45;
}

function drawArm(ctx: CanvasRenderingContext2D, f: Frame, side: -1 | 1, sleeve: string): void {
  ctx.save();
  ctx.translate(side * f.armX, -27.5 - f.bob);
  ctx.rotate(armAngle(f, side));
  ctx.fillStyle = sleeve;
  ctx.beginPath();
  ctx.roundRect(-2, 0, 4, 11, 1.8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = f.look.skin;
  circle(ctx, 0, 12, 2.1);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Staff held upright in the front hand, with a glowing orb on top. */
function drawStaff(ctx: CanvasRenderingContext2D, f: Frame): void {
  const angle = armAngle(f, 1);
  const handX = f.armX - 12 * Math.sin(angle);
  const handY = -27.5 - f.bob + 12 * Math.cos(angle);
  ctx.strokeStyle = WOOD;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(handX, handY - 27);
  ctx.lineTo(handX, handY + 13);
  ctx.stroke();
  resetStroke(ctx);

  ctx.save();
  ctx.shadowColor = ORB;
  ctx.shadowBlur = 6;
  ctx.fillStyle = ORB;
  circle(ctx, handX, handY - 29, 2.8);
  ctx.fill();
  ctx.restore();
  ctx.stroke();
}

function drawHead(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { look, headY } = f;
  const hideHair = look.headwear === 'hood' || look.headwear === 'helmet';

  ctx.fillStyle = look.skin;
  circle(ctx, 0, headY, 7);
  ctx.fill();
  ctx.stroke();

  drawFace(ctx, f);
  drawBeard(ctx, look.beard, look.hair, headY);
  drawMouth(ctx, f);

  if (!hideHair && look.hairStyle !== 'bald') {
    ctx.fillStyle = look.hair;
    ctx.beginPath();
    ctx.arc(-0.4, headY - 0.6, 7.4, Math.PI * 0.92, Math.PI * 2.02);
    ctx.lineTo(4.5, headY - 3.2);
    ctx.quadraticCurveTo(0, headY - 4.5, -6.5, headY + 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (look.hairStyle === 'bangs') {
      // Fringe stops just above the eyes.
      path(ctx, [
        [-1, headY - 6.6],
        [6.9, headY - 3.6],
        [5.7, headY - 2],
        [4.5, headY - 3.2],
        [3.3, headY - 1.9],
        [2.1, headY - 3.2],
        [0.7, headY - 2.1],
        [-0.6, headY - 3.9],
      ]);
      ctx.fill();
      ctx.stroke();
    }
  }

  drawHeadwear(ctx, f);
}

/**
 * Face turned three-quarters toward the facing side: the near eye at the front, the far eye
 * a bit smaller toward the middle, a small nose sticking out at the front.
 */
function drawFace(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { look, headY } = f;
  const eyeY = headY - 0.2;
  for (const [x, size] of [
    [NEAR_EYE_X, 1],
    [FAR_EYE_X, 0.82],
  ]) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(x, eyeY, 1.35 * size, 1.1 * size, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = look.eyes;
    circle(ctx, x + 0.25 * size, eyeY, 0.8 * size);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    circle(ctx, x + 0.45 * size, eyeY - 0.35 * size, 0.25 * size);
    ctx.fill();
  }

  ctx.strokeStyle = f.feminine ? '#1a1a1a' : shade(look.hair, -0.2);
  ctx.lineWidth = f.feminine ? 0.55 : 0.85;
  ctx.beginPath();
  for (const [x, size] of [
    [NEAR_EYE_X, 1],
    [FAR_EYE_X, 0.82],
  ]) {
    if (f.feminine) {
      // Lashes flicking up at the outer corner.
      ctx.moveTo(x + 0.9 * size, eyeY - 0.8 * size);
      ctx.lineTo(x + 1.7 * size, eyeY - 1.6 * size);
    } else {
      ctx.moveTo(x - 1.3 * size, eyeY - 2.1);
      ctx.lineTo(x + 1.4 * size, eyeY - 2.4);
    }
  }
  ctx.stroke();

  ctx.fillStyle = shade(look.skin, -0.22);
  path(ctx, [
    [5.3, headY + 0.3],
    [6.9, headY + 2],
    [5.3, headY + 2.3],
  ]);
  ctx.fill();
  resetStroke(ctx);
}

function drawMouth(ctx: CanvasRenderingContext2D, f: Frame): void {
  const mouthY = f.headY + 3.7;
  ctx.strokeStyle = f.feminine ? '#b5524c' : '#7a3b32';
  ctx.lineWidth = f.feminine ? 0.9 : 0.7;
  ctx.beginPath();
  ctx.moveTo(2.2, mouthY);
  ctx.quadraticCurveTo(3.4, mouthY + 0.7, 4.6, mouthY - 0.1);
  ctx.stroke();
  resetStroke(ctx);
}

function drawBeard(ctx: CanvasRenderingContext2D, beard: Beard, hair: string, headY: number): void {
  if (beard === 'none') return;
  ctx.fillStyle = hair;
  if (beard === 'mustache') {
    ctx.beginPath();
    ctx.ellipse(3.5, headY + 2.75, 2.5, 0.9, -0.1, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  if (beard === 'full') {
    ctx.arc(0, headY, 7.3, -Math.PI * 0.02, Math.PI * 0.72);
    ctx.lineTo(-2, headY + 8.5);
    ctx.quadraticCurveTo(2, headY + 11.5, 5, headY + 8.5);
    ctx.quadraticCurveTo(7.4, headY + 5, 7.1, headY + 0.5);
  } else {
    // Stubble and short beard share the jawline shape.
    ctx.arc(0, headY, 7.1, Math.PI * 0.02, Math.PI * 0.72);
    ctx.quadraticCurveTo(0.5, headY + 3.8, 5.6, headY + 1.4);
  }
  ctx.closePath();
  if (beard === 'stubble') {
    ctx.globalAlpha *= 0.4;
    ctx.fill();
    ctx.globalAlpha /= 0.4;
    return;
  }
  ctx.fill();
  ctx.stroke();
}

function drawHeadwear(ctx: CanvasRenderingContext2D, f: Frame): void {
  const { headY } = f;
  switch (f.look.headwear) {
    case 'hood':
      ctx.fillStyle = f.outfitDark;
      ctx.beginPath();
      ctx.arc(-0.5, headY, 9.3, Math.PI * 1.02, Math.PI * 1.98);
      ctx.lineTo(5, headY - 2.5);
      ctx.quadraticCurveTo(0, headY - 6, -6.5, headY + 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'helmet':
      // Dome above the eyes, with a nose guard coming down between them.
      ctx.fillStyle = STEEL;
      ctx.beginPath();
      ctx.arc(0, headY - 1.7, 7.9, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = STEEL_DARK;
      ctx.fillRect(-7.9, headY - 2.9, 15.8, 1.5);
      ctx.fillRect((NEAR_EYE_X + FAR_EYE_X) / 2 - 0.6, headY - 2.6, 1.2, 4.4);
      break;
    case 'wizard':
      ctx.fillStyle = WIZARD_HAT;
      ctx.beginPath();
      ctx.ellipse(0, headY - 5, 10.5, 2.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-6, headY - 5.5);
      ctx.quadraticCurveTo(-1, headY - 16, -5, headY - 23);
      ctx.quadraticCurveTo(3, headY - 15, 6, headY - 5.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.fillRect(-5.5, headY - 8, 11, 1.8);
      break;
    case 'bandana':
      ctx.fillStyle = f.look.accent;
      ctx.beginPath();
      ctx.roundRect(-7.3, headY - 5.2, 14.6, 3, 1);
      ctx.fill();
      ctx.stroke();
      // Knot tails at the back of the head.
      path(ctx, [
        [-6.8, headY - 4.4],
        [-11.5, headY - 1.5],
        [-10.2, headY + 1.6],
        [-6.4, headY - 2.4],
      ]);
      ctx.fill();
      ctx.stroke();
      break;
    case 'crown': {
      const base = headY - 5.2;
      ctx.fillStyle = CROWN;
      path(ctx, [
        [-5.5, base],
        [-5.5, base - 4],
        [-2.8, base - 1.8],
        [0, base - 5.5],
        [2.8, base - 1.8],
        [5.5, base - 4],
        [5.5, base],
      ]);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#c8342c';
      circle(ctx, 0, base - 1.4, 0.9);
      ctx.fill();
      break;
    }
    case 'none':
      break;
  }
}

// --- Helpers ---

function resetStroke(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.1;
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

function path(ctx: CanvasRenderingContext2D, points: [number, number][]): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

/** Lightens (amount > 0) or darkens (amount < 0) a #rrggbb color. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (n >> shift) & 0xff;
    const mixed = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.round(Math.max(0, Math.min(255, mixed)));
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
