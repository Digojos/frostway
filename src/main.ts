import { loadAppearance, randomAppearance } from './appearance';
import { AudioManager, type SfxName } from './audio';
import { CharacterEditor } from './characterEditor';
import { CONFIG } from './config';
import { SNAPSHOT_INTERVAL_TICKS, teamName } from './net/protocol';
import { Lobby } from './online/lobby';
import { drawMinimap, Renderer, type Effect } from './render/renderer';
import { Bot } from './sim/bot';
import {
  DUNGEON_PHASE,
  Game,
  PLAYER,
  TICK_RATE,
  type DamageSource,
  type GameEvent,
  type Player,
  type PlayerConfig,
} from './sim/game';
import { bananaCapsule, BANANA_TIMING, SPIKE_TIMING } from './sim/hazards';
import { spellCooldown, spellRange, SPELL_ORDER, type SpellId } from './sim/spells';
import './style.css';
import { byId, showPanel } from './ui';

type Mode = 'solo' | 'bots' | 'online';

const STEP_MS = 1000 / TICK_RATE;
/** Offline, the local player always has this id and team. */
const OFFLINE_ID = 1;
const OFFLINE_TEAM = 1;
const LOW_TIME_SECONDS = 30;
/** While the left button is held online, the walk target is re-sent this often. */
const MOVE_SEND_MS = 66;
const BOT_NAMES = ['Bot Gelo', 'Bot Neve', 'Bot Cristal', 'Bot Geada', 'Bot Inverno'];

const SPELL_UI: Record<SpellId, { name: string; icon: string; description: string }> = {
  hook: { name: 'Gancho', icon: '⚓', description: 'Puxa quem acertar até você e prende por um instante' },
  heal: { name: 'Cura', icon: '✚', description: 'Cura quem estiver sob o mouse ou você mesmo' },
  gust: { name: 'Rajada', icon: '🌀', description: 'Empurra forte quem acertar' },
  smoke: { name: 'Fumaça', icon: '☁', description: 'Nuvem que tira a visão de quem estiver dentro' },
  fire: { name: 'Fogo', icon: '🔥', description: 'Projétil de fogo que causa dano' },
  mark: { name: 'Marca', icon: '✖', description: 'Marca um X; a vítima volta para ele depois de alguns segundos' },
};

const HIT_SOUNDS: Record<DamageSource, SfxName> = {
  groundIce: 'hitGround',
  wallIce: 'hitWall',
  fire: 'fireHit',
  gust: 'hitWall',
};

const canvas = byId<HTMLCanvasElement>('game');
const ui = {
  hud: byId('hud'),
  menu: byId('menu'),
  resultTitle: byId('result-title'),
  resultText: byId('result-text'),
  hpFill: byId('hp-fill'),
  hpText: byId('hp-text'),
  timer: byId('timer'),
  phaseName: byId('phase-name'),
  skillBar: byId('skill-bar'),
  minimap: byId<HTMLCanvasElement>('minimap'),
  minimapTitle: byId('minimap-title'),
  message: byId('message'),
  victory: byId('victory'),
  victoryText: byId('victory-text'),
  app: byId('app'),
  respawn: byId('respawn'),
  respawnText: byId('respawn-text'),
  mute: byId<HTMLButtonElement>('mute'),
  musicVolume: byId<HTMLInputElement>('music-volume'),
  sfxVolume: byId<HTMLInputElement>('sfx-volume'),
  killFeed: byId('kill-feed'),
};

const renderer = new Renderer(canvas);
const audio = new AudioManager();
let mode: Mode = 'solo';
let localId = OFFLINE_ID;
let game = newGame('solo');
let bots: Bot[] = [];
let playing = false;
let effects: Effect[] = [];
let accumulator = 0;
let lastTime = performance.now();
let messageTimer = 0;
/** Distance walked since the last footstep sound. */
let walkedSinceStep = 0;
let selectedSpell: SpellId = SPELL_ORDER[0];
/** Spikes and wall sausages that already made their sound, so each sounds once. */
const announcedHazards = new Set<string>();
let lastMoveSentAt = 0;

const mouse = { x: 0, y: 0, leftDown: false, pendingCast: false };

// --- Players on this screen ---

/** The player controlled here, or undefined while spectating online. */
function localPlayer(): Player | undefined {
  return game.player(localId);
}

/** Whoever the camera follows: yourself, or the first player when spectating. */
function viewedPlayer(): Player {
  return localPlayer() ?? game.players[0];
}

function localTeam(): number | null {
  return localPlayer()?.team ?? null;
}

// --- Offline matches ---

function newGame(m: Exclude<Mode, 'online'>): Game {
  const appearance = loadAppearance();
  const players: PlayerConfig[] = [{ id: OFFLINE_ID, name: appearance.name, team: OFFLINE_TEAM, appearance }];
  if (m === 'bots') {
    for (let i = 0; i < CONFIG.bots.count; i++) {
      const name = BOT_NAMES[i % BOT_NAMES.length];
      players.push({ id: OFFLINE_ID + 1 + i, name, team: OFFLINE_TEAM + 1 + i, appearance: randomAppearance(name) });
    }
  }
  return new Game(players, {
    seed: (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0,
    timeLimitSeconds: CONFIG.match.timeLimitSeconds,
  });
}

function startOffline(m: Exclude<Mode, 'online'>): void {
  mode = m;
  localId = OFFLINE_ID;
  game = newGame(m);
  bots = game.players.filter((p) => p.id !== OFFLINE_ID).map((p) => new Bot(p.id, p.id * 7919 + Date.now()));
  beginMatch();
  showPanel(null);
}

/** Shared setup when any match (offline or online) starts on this screen. */
function beginMatch(): void {
  effects = [];
  accumulator = 0;
  walkedSinceStep = 0;
  announcedHazards.clear();
  ui.killFeed.replaceChildren();
  playing = true;
  ui.hud.classList.remove('hidden');
  ui.victory.classList.add('hidden');
  ui.skillBar.classList.toggle('hidden', !localPlayer());
  showMessage(localPlayer() ? game.courses[0].name : 'Assistindo à partida', '#bfe9ff');
  audio.playMusic(game.courses[0].theme);
}

function endMatchView(): void {
  playing = false;
  bots = [];
  updateDeathScreen(false);
  ui.hud.classList.add('hidden');
  audio.playMusic(null);
  game = newGame('solo');
  localId = OFFLINE_ID;
}

function showMenu(): void {
  mode = 'solo';
  endMatchView();
  showPanel('menu');
}

/** Winning doesn't stop the game: the banner stays while the player explores the dungeon. */
function showVictory(): void {
  const local = localPlayer();
  ui.victoryText.textContent = `Chegou à dungeon em ${formatTime(local?.finishTick ?? game.tick)}`;
  ui.victory.classList.remove('hidden');
}

function showResult(title: string, text: string): void {
  playing = false;
  updateDeathScreen(false);
  ui.resultTitle.textContent = title;
  ui.resultText.textContent = text;
  showPanel('result');
}

function onRaceOver(): void {
  const winner = game.players.find((p) => p.team === game.winnerTeam);
  const won = game.status === 'finished' && game.winnerTeam === localTeam();
  if (won) {
    showVictory();
    audio.playSfx('victory');
    return;
  }
  audio.playSfx('timeout');
  const title = game.status === 'timeout' ? 'Tempo esgotado' : 'Derrota';
  const text =
    game.status === 'timeout'
      ? 'Ninguém chegou à dungeon a tempo.'
      : mode === 'online'
        ? `O time ${teamName(game.winnerTeam!)} venceu!`
        : `${winner?.name ?? 'Outro time'} chegou à dungeon primeiro.`;
  // Online, everyone goes back to the room by themselves after a few seconds.
  if (mode === 'online') showMessage(`${title}: ${text}`, '#ffb347', 7);
  else showResult(title, text);
}

function showMessage(text: string, color = '#ffffff', seconds = 2.2): void {
  ui.message.textContent = text;
  ui.message.style.color = color;
  ui.message.classList.add('visible');
  window.clearTimeout(messageTimer);
  messageTimer = window.setTimeout(() => ui.message.classList.remove('visible'), seconds * 1000);
}

// --- Events, sounds and effects ---

/** Plays a sound happening at (x, y): quieter with distance, silent in another phase. */
function playAt(name: SfxName, phase: number, x: number, y: number): void {
  const viewer = viewedPlayer();
  if (!viewer || phase !== viewer.phase) return;
  const volume = 1 - Math.hypot(x - viewer.x, y - viewer.y) / CONFIG.audio.hazardHearingDistance;
  if (volume > 0) audio.playSfx(name, volume);
}

function handleEvent(event: GameEvent): void {
  const local = 'playerId' in event && event.playerId === localId;
  const who = 'playerId' in event ? game.player(event.playerId) : undefined;
  if ('playerId' in event && !who) return;
  switch (event.type) {
    case 'recall':
      effects.push({ kind: 'blink', phase: who!.phase, x: event.fromX, y: event.fromY, toX: event.toX, toY: event.toY, age: 0, life: 25 });
      playAt('recall', who!.phase, event.toX, event.toY);
      if (local) showMessage('A marca te puxou de volta!', '#ff8a7a', 1.6);
      break;
    case 'hit':
      effects.push({ kind: 'damage', phase: who!.phase, x: who!.x, y: who!.y, text: `-${event.damage}`, age: 0, life: 50 });
      if (local) audio.playSfx(HIT_SOUNDS[event.source]);
      break;
    case 'heal':
      effects.push({ kind: 'damage', phase: who!.phase, x: who!.x, y: who!.y, text: `+${event.amount}`, color: '#7dff9a', age: 0, life: 50 });
      playAt('heal', who!.phase, who!.x, who!.y);
      break;
    case 'cast': {
      const sounds: Partial<Record<SpellId, SfxName>> = { hook: 'hookCast', gust: 'gust', fire: 'fireCast', mark: 'markCast', smoke: 'gust' };
      const sound = sounds[event.spell];
      if (sound) playAt(sound, who!.phase, who!.x, who!.y);
      break;
    }
    case 'spellHit':
      if (event.spell === 'hook') playAt('hookHit', who!.phase, who!.x, who!.y);
      if (local && event.spell === 'mark') showMessage('Você foi marcado!', '#ff8a7a', 1.6);
      break;
    case 'smoke':
      playAt('smokeBurst', event.phase, event.x, event.y);
      break;
    case 'death': {
      const { outfit, skin } = who!.appearance;
      const life = Math.round(CONFIG.player.corpseSeconds * TICK_RATE);
      effects.push({ kind: 'corpse', phase: event.phase, x: event.x, y: event.y, color: outfit, skin, age: 0, life });
      if (local) audio.playSfx('death');
      addKillFeed(event.killerId === null ? undefined : game.player(event.killerId), who!);
      break;
    }
    case 'respawn':
      if (local) audio.playSfx('respawn');
      break;
    case 'phase':
      if (!local) break;
      if (event.phase !== DUNGEON_PHASE) showMessage(game.courses[event.phase].name, '#bfe9ff');
      audio.playSfx('portal');
      audio.playMusic(game.courses[event.phase].theme);
      break;
    case 'wrongPortal':
      if (!local) break;
      showMessage('Portal errado! De volta ao início da fase 2.', '#ffb347');
      audio.playSfx('wrongPortal');
      break;
    case 'finish':
      if (local) showMessage('Portal certo! Bem-vindo à dungeon.', '#ffd56a');
      else showMessage(`${who!.name} chegou à dungeon!`, '#ffb347');
      break;
    case 'status':
      onRaceOver();
      break;
  }
}

/** "[killer] matou [victim]" or "[victim] morreu" in the top-left corner, fading out after a while. */
function addKillFeed(killer: Player | undefined, victim: Player): void {
  const team = localTeam();
  const nameSpan = (p: Player) => {
    const span = document.createElement('span');
    span.className = p.team === team ? 'ally' : 'rival';
    span.textContent = p.name;
    return span;
  };
  const entry = document.createElement('div');
  entry.className = 'kill';
  if (killer) entry.append(nameSpan(killer), ' matou ', nameSpan(victim));
  else entry.append(nameSpan(victim), ' morreu');
  ui.killFeed.append(entry);
  while (ui.killFeed.childElementCount > CONFIG.killFeed.maxEntries) ui.killFeed.firstElementChild!.remove();
  window.setTimeout(() => entry.classList.add('fading'), CONFIG.killFeed.showSeconds * 1000);
  window.setTimeout(() => entry.remove(), CONFIG.killFeed.showSeconds * 1000 + 600);
}

/** Obstacles make noise the moment they come out, quieter the further away they are. */
function playHazardSounds(): void {
  const viewer = viewedPlayer();
  if (!viewer) return;
  const field = game.hazards[viewer.phase];
  for (const spike of field.spikes) {
    const key = `s${viewer.phase}:${spike.id}`;
    if (spike.age < SPIKE_TIMING.warn || announcedHazards.has(key)) continue;
    announcedHazards.add(key);
    playAt('iceErupt', viewer.phase, spike.x, spike.y);
  }
  for (const banana of field.bananas) {
    const key = `b${viewer.phase}:${banana.id}`;
    if (banana.age < BANANA_TIMING.warn || announcedHazards.has(key)) continue;
    announcedHazards.add(key);
    const { ax, ay } = bananaCapsule(field.course.zones[banana.zone], banana, 0);
    playAt('wallErupt', viewer.phase, ax, ay);
  }
  if (announcedHazards.size > 500) announcedHazards.clear();
}

/**
 * A footstep every `stepDistance` walked, so a slowed player's steps space out on their own.
 * Teleports don't count (px is reset), and being shoved or hooked is a slide, not steps.
 */
function playFootsteps(): void {
  const local = localPlayer();
  if (!local || !local.alive || local.kbx !== 0 || local.kby !== 0 || local.pull) return;
  const moved = Math.hypot(local.x - local.px, local.y - local.py);
  if (moved < 0.1) {
    walkedSinceStep = 0;
    return;
  }
  walkedSinceStep += moved;
  if (walkedSinceStep < CONFIG.audio.footsteps.stepDistance) return;
  walkedSinceStep = 0;
  audio.playFootstep(game.courses[local.phase].theme);
}

function ageEffects(ticks: number): void {
  for (const effect of effects) effect.age += ticks;
  effects = effects.filter((e) => e.age < e.life);
}

function updateMuteButton(): void {
  ui.mute.textContent = audio.settings.muted ? '🔇' : '🔊';
  ui.mute.title = audio.settings.muted ? 'Som desligado (M)' : 'Som ligado (M)';
}

// --- Input routing: the local simulation offline, the server online ---

function sendMove(x: number, y: number): void {
  if (mode === 'online') lobby.connection?.send({ t: 'move', x, y });
  else game.moveTo(localId, x, y);
}

function tryCast(x: number, y: number): void {
  const local = localPlayer();
  if (!local) return;
  if (local.cooldowns[selectedSpell] > 0) {
    flashDenied(selectedSpell);
    return;
  }
  if (mode === 'online') lobby.connection?.send({ t: 'cast', spell: selectedSpell, x, y });
  else game.cast(localId, selectedSpell, x, y);
}

function handleMouse(now: number): void {
  if (mouse.leftDown && (mode !== 'online' || now - lastMoveSentAt >= MOVE_SEND_MS)) {
    lastMoveSentAt = now;
    const target = renderer.screenToWorld(mouse.x, mouse.y);
    sendMove(target.x, target.y);
  }
  if (mouse.pendingCast) {
    mouse.pendingCast = false;
    const target = renderer.screenToWorld(mouse.x, mouse.y);
    tryCast(target.x, target.y);
  }
}

/** One offline simulation step. */
function tick(): void {
  for (const bot of bots) bot.think(game);
  game.step();
  for (const event of game.events) {
    for (const bot of bots) bot.onEvent(event);
    handleEvent(event);
  }
  game.events = [];
  playHazardSounds();
  playFootsteps();
  ageEffects(1);
}

// --- HUD ---

const skillSlots = new Map<SpellId, { slot: HTMLElement; cooldown: HTMLElement; countdown: HTMLElement }>();

function buildSkillBar(): void {
  ui.skillBar.replaceChildren(
    ...SPELL_ORDER.map((spell, i) => {
      const { name, icon, description } = SPELL_UI[spell];
      const slot = document.createElement('div');
      slot.className = 'skill';
      slot.title = `${name} (${i + 1}): ${description}`;
      const iconEl = document.createElement('div');
      iconEl.className = 'skill-icon';
      iconEl.textContent = icon;
      const cooldown = document.createElement('div');
      cooldown.className = 'cooldown';
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = String(i + 1);
      const countdown = document.createElement('span');
      countdown.className = 'countdown';
      slot.append(iconEl, cooldown, countdown, key);
      slot.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        selectSpell(spell);
      });
      skillSlots.set(spell, { slot, cooldown, countdown });
      return slot;
    }),
  );
  selectSpell(selectedSpell);
}

/** Brief red flash on a slot when the player tries to cast it while it's still recharging. */
function flashDenied(spell: SpellId): void {
  const slot = skillSlots.get(spell)?.slot;
  if (!slot) return;
  slot.classList.remove('denied');
  void slot.offsetWidth; // restart the animation if it's already running
  slot.classList.add('denied');
}

function selectSpell(spell: SpellId): void {
  selectedSpell = spell;
  for (const [id, { slot }] of skillSlots) slot.classList.toggle('selected', id === spell);
}

function updateHud(): void {
  const viewer = viewedPlayer();
  if (!viewer) return;
  ui.hpFill.style.width = `${(viewer.hp / PLAYER.maxHp) * 100}%`;
  ui.hpText.textContent = `${viewer.hp} / ${PLAYER.maxHp}`;
  ui.timer.textContent = formatTime(game.ticksLeft);
  ui.timer.classList.toggle('low', game.ticksLeft < LOW_TIME_SECONDS * TICK_RATE);
  const course = game.courses[viewer.phase];
  const spectating = !localPlayer();
  ui.phaseName.textContent = spectating ? `Assistindo ${viewer.name} · ${course.name}` : course.name;
  ui.minimapTitle.textContent = course.name;
  // While recharging, a slot is locked: grayed out, with the seconds left counting down.
  for (const [spell, { slot, cooldown, countdown }] of skillSlots) {
    const left = viewer.cooldowns[spell];
    cooldown.style.height = `${(left / spellCooldown(spell)) * 100}%`;
    slot.classList.toggle('cooling', left > 0);
    countdown.textContent = left > 0 ? String(Math.ceil(left / TICK_RATE)) : '';
  }
  drawMinimap(ui.minimap, game, viewer);
  updateDeathScreen(!spectating && !viewer.alive, viewer.respawnTicks);
}

/** Darkened world plus a countdown until the player comes back. */
function updateDeathScreen(dead: boolean, respawnTicks = 0): void {
  ui.app.classList.toggle('dead', dead);
  ui.respawn.classList.toggle('hidden', !dead);
  if (dead) ui.respawnText.textContent = `Você vai renascer em ${Math.max(1, Math.ceil(respawnTicks / TICK_RATE))}`;
}

function frame(now: number): void {
  let blend = 1;
  if (playing && mode === 'online') {
    handleMouse(now);
    blend = lobby.connection?.blend(now) ?? 1;
    updateHud();
  } else if (playing) {
    accumulator = Math.min(accumulator + (now - lastTime), 250);
    while (accumulator >= STEP_MS && playing) {
      handleMouse(now);
      tick();
      accumulator -= STEP_MS;
    }
    blend = accumulator / STEP_MS;
    updateHud();
  }
  lastTime = now;
  const viewer = viewedPlayer();
  if (viewer) {
    renderer.draw(game, viewer, blend, effects, {
      localTeam: localTeam() ?? -1,
      aimRange: playing && localPlayer() ? spellRange(selectedSpell) : null,
    });
  }
  requestAnimationFrame(frame);
}

function formatTime(ticks: number): string {
  const seconds = Math.ceil(ticks / TICK_RATE);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// --- Online ---

const lobby = new Lobby({
  onExit: showMenu,
  onMatchStart: () => {
    const connection = lobby.connection!;
    mode = 'online';
    game = connection.mirror!;
    localId = connection.myId;
    bots = [];
    beginMatch();
  },
  onState: (events) => {
    if (!playing) return;
    for (const event of events) handleEvent(event);
    playHazardSounds();
    playFootsteps();
    ageEffects(SNAPSHOT_INTERVAL_TICKS);
  },
  onMatchEnd: () => {
    if (mode !== 'online') return;
    endMatchView();
    mode = 'online';
  },
});

// --- Input: left button walks (hold to keep following the cursor), right button casts ---

canvas.addEventListener('pointermove', (e) => {
  mouse.x = e.offsetX;
  mouse.y = e.offsetY;
});
canvas.addEventListener('pointerdown', (e) => {
  mouse.x = e.offsetX;
  mouse.y = e.offsetY;
  if (e.button === 0) {
    mouse.leftDown = true;
    lastMoveSentAt = 0;
    canvas.setPointerCapture(e.pointerId);
  } else if (e.button === 2) {
    mouse.pendingCast = true;
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (e.button === 0) mouse.leftDown = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('blur', () => (mouse.leftDown = false));
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === 'Escape') {
    if (mode === 'online') lobby.handleEscape();
    else if (playing) showMenu();
  }
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && mode === 'online') {
    e.preventDefault();
    lobby.focusChat();
  }
  if (e.code === 'KeyM') {
    audio.toggleMute();
    updateMuteButton();
  }
  // Keys 1-6 (top row or numpad) pick the spell the right button casts.
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  const spell = digit ? SPELL_ORDER[Number(digit[1]) - 1] : undefined;
  if (spell) selectSpell(spell);
});

const characterEditor = new CharacterEditor(() => {
  // Back from the editor: rebuild the idle game so the new look shows behind the menu.
  game = newGame('solo');
  showPanel('menu');
});
byId('open-character').addEventListener('click', () => {
  showPanel('character');
  characterEditor.open();
});

byId('play').addEventListener('click', () => startOffline('solo'));
byId('play-bots').addEventListener('click', () => startOffline('bots'));
byId('play-online').addEventListener('click', () => {
  mode = 'online';
  lobby.open();
});
byId('play-again').addEventListener('click', () => startOffline(mode === 'bots' ? 'bots' : 'solo'));
byId('back-to-menu').addEventListener('click', showMenu);

// --- Sound controls: mute button in the HUD, volume sliders in the menu ---

ui.mute.addEventListener('click', () => {
  audio.toggleMute();
  updateMuteButton();
});
ui.musicVolume.value = String(Math.round(audio.settings.music * 100));
ui.sfxVolume.value = String(Math.round(audio.settings.sfx * 100));
ui.musicVolume.addEventListener('input', () => audio.setMusicVolume(Number(ui.musicVolume.value) / 100));
ui.sfxVolume.addEventListener('input', () => audio.setSfxVolume(Number(ui.sfxVolume.value) / 100));
// Let the player hear the effects volume they picked.
ui.sfxVolume.addEventListener('change', () => audio.playSfx('gust'));
updateMuteButton();
buildSkillBar();

if (import.meta.env.DEV) {
  // Debug hook for the browser console: window.frostway.game / .audio / .lobby
  Object.defineProperty(window, 'frostway', { value: { get game() { return game; }, audio, lobby } });
}

requestAnimationFrame(frame);
