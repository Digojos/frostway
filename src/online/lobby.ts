import { loadAppearance } from '../appearance';
import { TEAM_COLORS, TEAM_COUNT, teamName, type RoomPlayer, type RoomSummary } from '../net/protocol';
import type { GameEvent } from '../sim/game';
import { byId, showPanel } from '../ui';
import { Connection } from './connection';

const MAX_CHAT_LINES = 60;

export interface LobbyHooks {
  /** Player left the online mode (back to the main menu). */
  onExit(): void;
  onMatchStart(): void;
  onState(events: GameEvent[]): void;
  onMatchEnd(): void;
}

/** Online screens: room list, create room, room (teams and settings) and chat. */
export class Lobby {
  connection: Connection | null = null;
  /** During a match the room screen can be toggled with Esc. */
  private roomViewOpen = true;
  private closingOnPurpose = false;

  private readonly el = {
    status: byId('online-status'),
    error: byId('online-error'),
    roomList: byId('room-list'),
    roomsEmpty: byId('rooms-empty'),
    createForm: byId<HTMLFormElement>('create-form'),
    roomName: byId<HTMLInputElement>('room-name'),
    roomTitle: byId('room-title'),
    teams: byId('teams'),
    teamSize: byId<HTMLSelectElement>('team-size'),
    timeLimit: byId<HTMLSelectElement>('time-limit'),
    botCount: byId<HTMLSelectElement>('bot-count'),
    startStop: byId<HTMLButtonElement>('start-stop'),
    chat: byId('chat'),
    chatLog: byId('chat-log'),
    chatInput: byId<HTMLInputElement>('chat-input'),
  };

  constructor(private readonly hooks: LobbyHooks) {
    const { el } = this;
    byId('create-room').addEventListener('click', () => {
      el.roomName.value = '';
      showPanel('online-create');
      el.roomName.focus();
    });
    el.createForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.connection?.send({ t: 'createRoom', name: el.roomName.value });
    });
    byId('create-cancel').addEventListener('click', () => showPanel('online-rooms'));
    byId('refresh-rooms').addEventListener('click', () => this.connection?.send({ t: 'listRooms' }));
    byId('online-back').addEventListener('click', () => this.exit());
    el.roomList.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('tr[data-id]');
      if (row) this.connection?.send({ t: 'joinRoom', roomId: row.dataset.id! });
    });
    el.teams.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-team]');
      const connection = this.connection;
      if (!button || !connection) return;
      const team = button.dataset.team === 'spec' ? null : Number(button.dataset.team);
      connection.send({ t: 'setTeam', playerId: connection.myId, team });
    });
    for (const select of [el.teamSize, el.timeLimit, el.botCount]) {
      select.addEventListener('change', () => {
        this.connection?.send({
          t: 'settings',
          settings: {
            teamSize: Number(el.teamSize.value) as 1 | 2 | 3,
            timeLimitSeconds: Number(el.timeLimit.value),
            bots: Number(el.botCount.value),
          },
        });
        select.blur();
      });
    }
    el.startStop.addEventListener('click', () => this.connection?.send({ t: this.connection.running ? 'stop' : 'start' }));
    byId('leave-room').addEventListener('click', () => this.connection?.send({ t: 'leaveRoom' }));

    el.chatInput.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        const text = el.chatInput.value.trim();
        if (text) this.connection?.send({ t: 'chat', text });
        el.chatInput.value = '';
        el.chatInput.blur();
      } else if (e.code === 'Escape') {
        el.chatInput.blur();
        e.stopPropagation();
      }
    });
  }

  get inMatch(): boolean {
    return this.connection?.mirror != null;
  }

  open(): void {
    this.closingOnPurpose = false;
    this.el.error.classList.add('hidden');
    this.el.status.textContent = 'Conectando...';
    this.renderRoomList([]);
    showPanel('online-rooms');

    this.connection = new Connection(loadAppearance(), {
      onClose: (wasOpen) => {
        this.connection = null;
        this.el.chat.classList.add('hidden');
        if (this.closingOnPurpose) return;
        this.hooks.onExit();
        showPanel('online-rooms');
        this.el.status.textContent = wasOpen ? 'Conexão com o servidor perdida.' : 'Não foi possível conectar ao servidor.';
      },
      onRooms: (rooms) => {
        this.el.status.textContent = 'Escolha uma sala ou crie uma nova.';
        this.renderRoomList(rooms);
        if (!this.connection?.inRoom) showPanel('online-rooms');
      },
      onJoined: () => {
        this.roomViewOpen = true;
        this.el.chatLog.replaceChildren();
        this.el.chat.classList.remove('hidden');
      },
      onLeft: () => {
        this.el.chat.classList.add('hidden');
        this.hooks.onMatchEnd();
        showPanel('online-rooms');
      },
      onRoom: () => this.renderRoom(),
      onChat: (from, text) => this.appendChat(from, text),
      onError: (message) => {
        if (this.connection?.inRoom) return this.appendChat(null, message);
        this.el.error.textContent = message;
        this.el.error.classList.remove('hidden');
      },
      onMatchStart: () => {
        this.roomViewOpen = false;
        this.refreshPanels();
        this.hooks.onMatchStart();
      },
      onState: (events) => this.hooks.onState(events),
      onMatchEnd: () => {
        this.roomViewOpen = true;
        this.hooks.onMatchEnd();
        this.refreshPanels();
      },
    });
  }

  /** Leaves online mode and closes the connection. */
  exit(): void {
    if (this.connection) {
      this.closingOnPurpose = true;
      this.connection.close();
      this.connection = null;
    }
    this.el.chat.classList.add('hidden');
    this.hooks.onExit();
  }

  /** Esc during a match shows or hides the room screen. */
  handleEscape(): void {
    if (!this.inMatch) return;
    this.roomViewOpen = !this.roomViewOpen;
    this.refreshPanels();
  }

  focusChat(): void {
    if (this.connection?.inRoom) this.el.chatInput.focus();
  }

  private refreshPanels(): void {
    if (!this.connection?.inRoom) return;
    showPanel(this.roomViewOpen || !this.inMatch ? 'online-room' : null);
  }

  private renderRoomList(rooms: RoomSummary[]): void {
    const { el } = this;
    el.roomList.replaceChildren(
      ...rooms.map((room) => {
        const row = document.createElement('tr');
        row.dataset.id = room.id;
        row.append(cell(room.name), cell(`${room.players}/${room.maxPlayers}`), cell(room.running ? 'Em jogo' : 'Aguardando'));
        return row;
      }),
    );
    el.roomsEmpty.classList.toggle('hidden', rooms.length > 0);
  }

  private renderRoom(): void {
    const connection = this.connection;
    if (!connection) return;
    const { el } = this;
    const isAdmin = connection.me?.admin ?? false;
    const { settings, running } = connection;

    el.roomTitle.textContent = connection.roomName;
    const columns: (number | null)[] = [...Array.from({ length: TEAM_COUNT }, (_, i) => i + 1), null];
    el.teams.replaceChildren(
      ...columns.map((team) => {
        const members = connection.players.filter((p) => p.team === team);
        const column = document.createElement('div');
        column.className = 'team-column';
        const title = document.createElement('h2');
        title.textContent = team === null ? 'Espectadores' : `${teamName(team)} (${members.length}/${settings.teamSize})`;
        if (team !== null) title.style.color = TEAM_COLORS[team - 1];
        const list = document.createElement('ul');
        list.append(...members.map((p) => this.playerItem(p)));
        const join = document.createElement('button');
        join.className = 'secondary';
        join.textContent = 'Entrar';
        join.dataset.team = team === null ? 'spec' : String(team);
        join.disabled = running || connection.me?.team === team || (team !== null && members.length >= settings.teamSize);
        column.append(title, list, join);
        return column;
      }),
    );

    el.teamSize.value = String(settings.teamSize);
    el.timeLimit.value = String(settings.timeLimitSeconds);
    el.botCount.value = String(settings.bots);
    for (const select of [el.teamSize, el.timeLimit, el.botCount]) select.disabled = !isAdmin || running;
    el.startStop.textContent = running ? 'Parar partida' : 'Iniciar partida';
    el.startStop.disabled = !isAdmin;
    el.startStop.title = isAdmin ? '' : 'Só o admin pode iniciar a partida';
    this.refreshPanels();
  }

  private playerItem(player: RoomPlayer): HTMLElement {
    const item = document.createElement('li');
    if (player.id === this.connection?.myId) item.classList.add('me');
    item.textContent = player.name + (player.admin ? ' ★' : '');
    return item;
  }

  private appendChat(from: string | null, text: string): void {
    const { chatLog } = this.el;
    const line = document.createElement('div');
    if (from === null) {
      line.className = 'system';
      line.textContent = text;
    } else {
      const who = document.createElement('b');
      who.textContent = `${from}: `;
      line.append(who, text);
    }
    chatLog.append(line);
    while (chatLog.childElementCount > MAX_CHAT_LINES) chatLog.firstElementChild!.remove();
    chatLog.scrollTop = chatLog.scrollHeight;
  }
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}
