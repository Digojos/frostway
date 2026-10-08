import {
  ACCENT_COLORS,
  BEARDS,
  BODIES,
  EYE_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  HEADWEAR,
  loadAppearance,
  OUTFIT_COLORS,
  PANTS_COLORS,
  sanitizeAppearance,
  saveAppearance,
  SKIN_TONES,
  WEAPONS,
  type Appearance,
} from './appearance';
import { drawCharacter } from './render/character';

const PREVIEW_UNIT = 3;
/** The preview turns around every few seconds to show both sides. */
const TURN_EVERY_MS = 2500;

/** "Personagem" screen: picks name, colors, hair and gear, with a live walking preview. */
export class CharacterEditor {
  private look: Appearance = loadAppearance();
  private animation = 0;
  private readonly el = {
    panel: byId('character'),
    preview: byId<HTMLCanvasElement>('character-preview'),
    name: byId<HTMLInputElement>('char-name'),
    body: byId('char-body'),
    outfit: byId('char-outfit'),
    pants: byId('char-pants'),
    skin: byId('char-skin'),
    eyes: byId('char-eyes'),
    hair: byId('char-hair'),
    hairStyle: byId('char-hair-style'),
    beard: byId('char-beard'),
    headwear: byId('char-headwear'),
    cape: byId('char-cape'),
    accent: byId('char-accent'),
    weapon: byId('char-weapon'),
  };

  constructor(private readonly onDone: () => void) {
    this.el.name.addEventListener('input', () => this.update({ name: this.el.name.value }));
    byId('character-done').addEventListener('click', () => this.close());
  }

  open(): void {
    this.look = loadAppearance();
    this.el.name.value = this.look.name;
    this.renderOptions();
    this.el.panel.classList.remove('hidden');
    const start = performance.now();
    const loop = (now: number) => {
      this.drawPreview(now - start);
      this.animation = requestAnimationFrame(loop);
    };
    this.animation = requestAnimationFrame(loop);
  }

  private close(): void {
    cancelAnimationFrame(this.animation);
    this.el.panel.classList.add('hidden');
    this.onDone();
  }

  private update(change: Partial<Appearance>): void {
    this.look = sanitizeAppearance({ ...this.look, ...change });
    saveAppearance(this.look);
    this.renderOptions();
  }

  private renderOptions(): void {
    const { el, look } = this;
    choices(el.body, BODIES, look.body, (body) => this.update({ body }));
    swatches(el.outfit, OUTFIT_COLORS, look.outfit, (outfit) => this.update({ outfit }));
    swatches(el.pants, PANTS_COLORS, look.pants, (pants) => this.update({ pants }));
    swatches(el.skin, SKIN_TONES, look.skin, (skin) => this.update({ skin }));
    swatches(el.eyes, EYE_COLORS, look.eyes, (eyes) => this.update({ eyes }));
    swatches(el.hair, HAIR_COLORS, look.hair, (hair) => this.update({ hair }));
    choices(el.hairStyle, HAIR_STYLES, look.hairStyle, (hairStyle) => this.update({ hairStyle }));
    choices(el.beard, BEARDS, look.beard, (beard) => this.update({ beard }));
    choices(el.headwear, HEADWEAR, look.headwear, (headwear) => this.update({ headwear }));
    choices(el.cape, { no: 'Sem capa', yes: 'Com capa' }, look.cape ? 'yes' : 'no', (v) => this.update({ cape: v === 'yes' }));
    swatches(el.accent, ACCENT_COLORS, look.accent, (accent) => this.update({ accent }));
    choices(el.weapon, WEAPONS, look.weapon, (weapon) => this.update({ weapon }));
  }

  private drawPreview(elapsed: number): void {
    const canvas = this.el.preview;
    const ctx = canvas.getContext('2d')!;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const floorY = height - 34;
    const snow = ctx.createRadialGradient(width / 2, floorY, 4, width / 2, floorY, width / 2);
    snow.addColorStop(0, '#e7eef5');
    snow.addColorStop(1, 'rgba(231, 238, 245, 0)');
    ctx.fillStyle = snow;
    ctx.beginPath();
    ctx.ellipse(width / 2, floorY, width / 2 - 6, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(width / 2, floorY, 26, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    const facing = Math.floor(elapsed / TURN_EVERY_MS) % 2 === 0 ? 1 : -1;
    drawCharacter(ctx, width / 2, floorY, PREVIEW_UNIT, this.look, { facing, walk: elapsed * 0.008, moving: true });
  }
}

function swatches(container: HTMLElement, colors: string[], selected: string, onPick: (color: string) => void): void {
  container.replaceChildren(
    ...colors.map((color) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch' + (color === selected ? ' selected' : '');
      button.style.background = color;
      button.title = color;
      button.addEventListener('click', () => onPick(color));
      return button;
    }),
  );
}

function choices<T extends string>(container: HTMLElement, options: Record<T, string>, selected: T, onPick: (value: T) => void): void {
  container.replaceChildren(
    ...(Object.entries(options) as [T, string][]).map(([value, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice' + (value === selected ? ' selected' : '');
      button.textContent = label;
      button.addEventListener('click', () => onPick(value));
      return button;
    }),
  );
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
