import { CONFIG } from './config';

export type MusicName = keyof typeof CONFIG.audio.music;
export type SfxName = keyof typeof CONFIG.audio.sfx;

interface AudioSettings {
  music: number;
  sfx: number;
  muted: boolean;
}

const STORAGE_KEY = 'frostway.audio';
const FADE_STEP_MS = 30;

/**
 * Background music (one looping track at a time, crossfaded) and one-shot sound effects.
 * Browsers only allow sound after the user interacts with the page, so the first
 * `playMusic` should come from a click (e.g. the Play button).
 */
export class AudioManager {
  readonly settings: AudioSettings;
  private current: { name: MusicName; element: HTMLAudioElement } | null = null;
  private readonly fades = new Map<HTMLAudioElement, number>();
  /** Files that failed to load; they are skipped instead of retried on every play. */
  private readonly missing = new Set<string>();
  private readonly sfxTemplates = new Map<string, HTMLAudioElement>();

  constructor() {
    this.settings = { music: CONFIG.audio.musicVolume, sfx: CONFIG.audio.sfxVolume, muted: false, ...loadSettings() };
  }

  /** Switches the background track (null = silence), fading between them. */
  playMusic(name: MusicName | null): void {
    if (this.current?.name === name) return;
    if (this.current) {
      const old = this.current.element;
      this.fade(old, 0, () => old.pause());
      this.current = null;
    }
    if (!name) return;

    const url = assetUrl(CONFIG.audio.music[name]);
    if (this.missing.has(url)) return;
    const element = new Audio(url);
    element.loop = true;
    element.volume = 0;
    element.addEventListener('error', () => this.missing.add(url), { once: true });
    element.play().catch(() => {
      // Missing file or blocked autoplay: stay silent.
    });
    this.current = { name, element };
    this.fade(element, this.musicVolume);
  }

  /** Plays a one-shot sound; `scale` lowers it, e.g. for distant obstacles. */
  playSfx(name: SfxName, scale = 1): void {
    this.playFile(CONFIG.audio.sfx[name], scale);
  }

  /** One footstep on the given floor, picking a random variation so steps don't sound identical. */
  playFootstep(floor: MusicName): void {
    const variations = CONFIG.audio.footsteps[floor];
    this.playFile(variations[Math.floor(Math.random() * variations.length)], CONFIG.audio.footsteps.volume);
  }

  private playFile(path: string, scale: number): void {
    const volume = this.settings.muted ? 0 : this.settings.sfx * scale;
    if (volume <= 0.01) return;
    const url = assetUrl(path);
    if (this.missing.has(url)) return;

    let template = this.sfxTemplates.get(url);
    if (!template) {
      template = new Audio(url);
      template.preload = 'auto';
      template.addEventListener('error', () => this.missing.add(url), { once: true });
      this.sfxTemplates.set(url, template);
    }
    // A fresh copy per play so the same sound can overlap itself.
    const instance = template.cloneNode() as HTMLAudioElement;
    instance.volume = Math.min(1, volume);
    instance.play().catch(() => {});
  }

  setMusicVolume(value: number): void {
    this.settings.music = clamp01(value);
    this.applyMusicVolume();
    this.save();
  }

  setSfxVolume(value: number): void {
    this.settings.sfx = clamp01(value);
    this.save();
  }

  toggleMute(): boolean {
    this.settings.muted = !this.settings.muted;
    this.applyMusicVolume();
    this.save();
    return this.settings.muted;
  }

  private get musicVolume(): number {
    return this.settings.muted ? 0 : this.settings.music;
  }

  private applyMusicVolume(): void {
    if (this.current) this.fade(this.current.element, this.musicVolume, undefined, 150);
  }

  /**
   * Volume ramp on a timer rather than animation frames: those stop in background tabs,
   * which would leave the music stuck silent.
   */
  private fade(element: HTMLAudioElement, to: number, onDone?: () => void, ms = CONFIG.audio.musicFadeSeconds * 1000): void {
    clearInterval(this.fades.get(element));
    const from = element.volume;
    const start = performance.now();
    const timer = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / ms);
      element.volume = from + (to - from) * t;
      if (t < 1) return;
      clearInterval(timer);
      this.fades.delete(element);
      onDone?.();
    }, FADE_STEP_MS);
    this.fades.set(element, timer);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Storage unavailable (private window etc.): settings just won't persist.
    }
  }
}

function loadSettings(): Partial<AudioSettings> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<AudioSettings>;
    return typeof saved === 'object' && saved !== null ? saved : {};
  } catch {
    return {};
  }
}

/** Folder names in the sound pack have spaces ("Combat and Gore"), so the path is URL-encoded. */
function assetUrl(path: string): string {
  return import.meta.env.BASE_URL + encodeURI(path);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
