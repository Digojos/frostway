# Frostway

Jogo de percurso em gelo, isométrico, inspirado no mapa "Illusions Way" do DarkEden. Times correm por duas fases de gelo, se atrapalham com magias e disputam quem chega primeiro à dungeon. Dá para jogar sozinho, contra bots ou **online**.

## Rodando

```bash
npm install
npm run dev
```

Abra http://localhost:5180. O comando sobe o servidor do jogo (WebSocket) e o site juntos, na mesma porta.

Produção:

```bash
npm run build
npm start
```

A porta pode ser trocada com a variável de ambiente `PORT`.

## Modos

- **Jogar sozinho:** o percurso contra o relógio.
- **Jogar contra bots:** 3 bots rivais, que desviam do gelo e usam magias.
- **Jogar online:** salas com times **Azul, Vermelho, Verde e Amarelo**. O admin (★) escolhe o tamanho do time (solo, dupla, trio), o tempo e quantos bots completam a sala. Há um chat (Enter); durante a partida, **Esc** mostra/esconde a sala.

## Como jogar

- **Clique esquerdo:** andar (segure para seguir o mouse)
- **1 a 6:** escolhe a magia (Gancho, Cura, Rajada, Fumaça, Fogo, Marca)
- **Clique direito:** lança a magia escolhida na direção do mouse
- **M:** liga/desliga o som
- **Esc:** voltar ao menu (online: mostra/esconde a sala)

As fases:

- **Fase 1, caracol:** desvie do gelo que sai do chão (o círculo azul avisa onde). Depois da 2ª curva ele fica maior; depois da 4ª, salsichas de gelo saem das paredes. Entre no portal no centro.
- **Fase 2, zigue-zague:** no fim há 3 portais e só um leva para a dungeon, sorteado a cada partida. O errado manda você de volta ao início da fase 2.
- **Regras gerais:** morrer devolve você ao início da fase atual. O tempo vale para as duas fases. Vence o primeiro time com todos na dungeon.

## Personagem

No menu, **Personagem** abre o editor: nome, corpo, cores de roupa, calça, pele, olhos e cabelo, penteado, barba, item de cabeça, capa e arma, com uma prévia animada. A escolha fica salva no navegador e é o que os outros jogadores veem online. É só visual.

## Configuração

Tempo, velocidade, dano, lentidão, empurrão, frequência dos obstáculos, magias e bots ficam em [`src/config.ts`](src/config.ts), com comentários.

## Música e sons

Os sons em uso ficam em `public/audio/` (veja [public/audio/LEIA-ME.md](public/audio/LEIA-ME.md)). O acervo completo fica fora do projeto, em `C:\repos\gaming\_sons`.

## Documentação

- [docs/design.md](docs/design.md): regras, magias, multiplayer, decisões em aberto, números de balanceamento e roteiro.

## Estrutura

| Arquivo | Responsabilidade |
| --- | --- |
| `src/config.ts` | Todos os números ajustáveis do jogo |
| `src/sim/` | Simulação (sem navegador): mapas, obstáculos, magias, regras, bots. Roda no navegador (offline) e no servidor (online) |
| `src/net/protocol.ts` / `src/net/snapshot.ts` | Mensagens cliente ↔ servidor e o "retrato" do estado enviado aos clientes |
| `server/index.ts` / `server/room.ts` | Servidor HTTP + WebSocket, salas, times, partida e envio de estado |
| `src/online/connection.ts` / `src/online/lobby.ts` | Conexão com o servidor e as telas online (salas, sala, chat) |
| `src/render/` | Desenho isométrico, minimapa e personagem |
| `src/appearance.ts` / `src/characterEditor.ts` | Opções de visual e a tela "Personagem" |
| `src/audio.ts` | Música, efeitos sonoros e passos |
| `src/main.ts` | Loop, entrada, HUD e menus |
