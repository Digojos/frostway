import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { sanitizeAppearance } from '../src/appearance';
import {
  MAX_CHAT_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  type ClientMessage,
  type RoomSummary,
  type ServerMessage,
} from '../src/net/protocol';
import { TICK_RATE } from '../src/sim/game';
import { Room, type Client } from './room';

const PORT = Number(process.env.PORT ?? 5180);
const PRODUCTION = process.argv.includes('--prod');
const PROJECT_DIR = resolve(import.meta.dirname, '..');
const DIST_DIR = join(PROJECT_DIR, 'dist');
const STEP_MS = 1000 / TICK_RATE;
const MAX_MESSAGE_BYTES = 8192;

const rooms = new Map<string, Room>();
let nextClientId = 1;

// --- HTTP: Vite middleware in development, static files from dist/ in production ---

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.json': 'application/json',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  let file = resolve(DIST_DIR, '.' + urlPath);
  if (!file.startsWith(DIST_DIR + sep) && file !== DIST_DIR) {
    res.writeHead(403).end();
    return;
  }
  if (urlPath.endsWith('/')) file = join(file, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    try {
      const body = await readFile(join(DIST_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] }).end(body);
    } catch {
      res.writeHead(404).end('Build não encontrado. Rode "npm run build" antes de "npm start".');
    }
  }
}

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;
const httpServer = createServer();

let handleRequest: RequestHandler;
if (PRODUCTION) {
  handleRequest = (req, res) => void serveStatic(req, res);
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: PROJECT_DIR,
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: 'spa',
  });
  handleRequest = (req, res) => vite.middlewares(req, res);
}

httpServer.on('request', (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: 'ok', rooms: rooms.size }));
    return;
  }
  handleRequest(req, res);
});

// --- WebSocket ---

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

httpServer.on('upgrade', (req, socket, head) => {
  if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') return; // e.g. Vite HMR
  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws));
});

function onConnection(socket: WebSocket): void {
  let greeted = false;
  const client: Client = {
    id: nextClientId++,
    appearance: sanitizeAppearance({}),
    room: null,
    send: (message: ServerMessage) => client.sendRaw(JSON.stringify(message)),
    sendRaw: (json: string) => {
      if (socket.readyState === socket.OPEN) socket.send(json);
    },
  };

  socket.on('message', (data: RawData) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    if (message.t === 'hello') {
      greeted = true;
      client.appearance = sanitizeAppearance(message.appearance ?? {});
      client.send({ t: 'welcome', id: client.id });
      client.send({ t: 'rooms', rooms: roomList() });
      return;
    }
    if (!greeted) return;
    try {
      handleMessage(client, message);
    } catch (error) {
      console.error(`Erro ao processar mensagem de ${client.id}:`, error);
    }
  });

  socket.on('close', () => leaveCurrentRoom(client));
}

function handleMessage(client: Client, message: ClientMessage): void {
  const room = client.room;
  switch (message.t) {
    case 'ping':
      return client.send({ t: 'pong', time: message.time });
    case 'listRooms':
      return client.send({ t: 'rooms', rooms: roomList() });
    case 'createRoom': {
      const name = cleanText(message.name, MAX_ROOM_NAME_LENGTH) || `Sala de ${client.appearance.name}`;
      leaveCurrentRoom(client);
      const created = new Room(randomBytes(4).toString('hex'), name);
      rooms.set(created.id, created);
      created.join(client);
      return;
    }
    case 'joinRoom': {
      const target = rooms.get(String(message.roomId));
      if (!target) return client.send({ t: 'error', message: 'Sala não encontrada' });
      if (target.isFull) return client.send({ t: 'error', message: 'Sala cheia' });
      if (target === room) return;
      leaveCurrentRoom(client);
      target.join(client);
      return;
    }
    case 'leaveRoom':
      leaveCurrentRoom(client);
      return client.send({ t: 'rooms', rooms: roomList() });
    case 'setTeam':
      return room?.setTeam(client, Number(message.playerId), message.team === null ? null : Number(message.team));
    case 'settings':
      return room?.updateSettings(client, message.settings ?? {});
    case 'start':
      return room?.start(client);
    case 'stop':
      return room?.stop(client);
    case 'chat': {
      const text = cleanText(message.text, MAX_CHAT_LENGTH);
      if (text) room?.chat(client, text);
      return;
    }
    case 'move':
      return room?.move(client, Number(message.x), Number(message.y));
    case 'cast':
      return room?.cast(client, message.spell, Number(message.x), Number(message.y));
  }
}

function leaveCurrentRoom(client: Client): void {
  const room = client.room;
  if (!room) return;
  room.leave(client);
  if (room.clients.size === 0) rooms.delete(room.id);
}

function roomList(): RoomSummary[] {
  return [...rooms.values()].map((r) => r.summary);
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return [...value.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim()].slice(0, maxLength).join('');
}

// --- Fixed-step simulation loop ---

let lastTime = performance.now();
let accumulator = 0;

function loop(): void {
  const now = performance.now();
  accumulator = Math.min(accumulator + (now - lastTime), 250);
  lastTime = now;
  while (accumulator >= STEP_MS) {
    for (const room of rooms.values()) room.tick();
    accumulator -= STEP_MS;
  }
  setTimeout(loop, 1);
}
loop();

httpServer.listen(PORT, () => {
  console.log(`Frostway ${PRODUCTION ? '(produção)' : '(dev)'} rodando em http://localhost:${PORT}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    for (const socket of wss.clients) socket.close(1001, 'Servidor reiniciando');
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
