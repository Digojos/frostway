# Frostway: documento de design

> Nome provisório. Jogo de percurso em gelo, isométrico, inspirado no mapa "Illusions Way" do DarkEden.

## Visão geral

Times largam juntos no início de um caminho de gelo suspenso no vazio e precisam chegar ao portal final antes que o tempo acabe:

- **Obstáculos:** o gelo sai do chão e das paredes em pontos aleatórios do percurso.
- **Fases:** a fase 1 é um caracol; a fase 2 é um zigue-zague com três portais, dos quais só um é o certo.
- **Times e PvP:** solo, dupla ou trio; durante o percurso, os times podem se atrapalhar com magias.

Haverá uma **versão offline** (treino) e uma **versão multiplayer** (navegador, servidor autoritativo, como no HaxLike).

## Decisões fechadas

| Tema | Decisão |
| --- | --- |
| Plataforma | Navegador (TypeScript + Canvas), servidor Node para o online |
| Visual | Isométrico, no estilo do DarkEden |
| Controles | Clique esquerdo anda (segurar segue o mouse); clique direito usa a magia selecionada |
| Vida | Cada jogador tem HP (100) |
| Morte | Só quem morreu volta ao início da fase em que está |
| Fase 1 | Caracol; gelo do chão com raio maior a partir da 2ª curva; lâminas laterais ("bananas") a partir da 4ª curva |
| Fase 2 | Zigue-zague (sobe, esquerda, desce, esquerda, ...); 3 portais no fim, 1 certo sorteado a cada partida |
| Portal errado | Só quem entrou volta ao início da fase 2 |
| Tempo | Um cronômetro único para as duas fases; se acabar, é game over |
| Times | Solo, dupla ou trio |
| Objetivo do time | O ideal é que todos do time cheguem ao portal final |
| PvP | Existe durante o percurso, por magias |

## Decisões em aberto (valores atuais do protótipo entre parênteses)

1. **Tempo da partida** (4 minutos). Um percurso limpo leva cerca de 35 s na fase 1 e 60 s na fase 2.
2. **Vitória do time:** precisa que **todos** passem pelo portal, ou ganha o primeiro time a ter todos dentro? E se o tempo acabar com o time pela metade? (Offline: vence quem passar.)
3. **Magias de PvP:** causam dano ou só atrapalham (empurrar, congelar)? Quais e quantas? (Só o Blink, de teste.)
4. **Fogo amigo:** magias acertam o próprio time? (Ainda não se aplica.)
5. **Portal certo:** o mesmo para todos os times, ou um sorteio por time? (Um sorteio por partida.)
6. **Reviver:** colega pode reviver quem morreu, em vez de voltar ao início? (Não.)
7. **Quantos times por partida** (ainda não definido; sugestão: até 4 times de 3).

## Mecânicas do protótipo

Todos os números desta seção ficam em **`src/config.ts`**, comentados. É o lugar para ajustar a dificuldade.

### Movimento

- Clique esquerdo define o destino; segurar o botão faz o personagem seguir o mouse.
- Velocidade: 156 unidades por segundo.
- O personagem desliza nas paredes e não cai no vazio.

### Gelo do chão

- **Ciclo:** aviso em círculo azul girando (0,9 s), depois os cristais saem (0,37 s) e somem.
- **Efeito:** **30** de dano e **45% de lentidão por 2 s**. Enquanto lento, o personagem fica com um anel azul nos pés.
- **Raio:** 32 nas duas primeiras retas, 54 a partir da 2ª curva.
- **Mira:** 40% dos gelos miram onde o jogador **vai estar**, então parar ou correr reto não é seguro.

### Gelo da parede ("salsicha")

- **Ciclo:** brilho na parede como aviso (0,7 s), a salsicha de gelo sai até o meio do corredor, segura 0,6 s e recolhe.
- **Efeito:** **35** de dano, **20% de lentidão por 2 s** e um **empurrão de 90** ao longo do corredor. Quem encosta do lado da frente da salsicha é empurrado para frente; quem encosta do lado de trás, para trás.
- **Lado:** sorteado. Nunca saem duas no mesmo ponto, então sempre há metade do corredor livre.
- **Lentidões:** a mais forte vale; uma igual ou mais fraca só renova o tempo se não houver outra mais forte ativa.

### Onde os obstáculos aparecem

- Só nas retas onde há jogadores e na seguinte; nunca perto do início nem dos portais.
- Densidade por reta: cerca de 1,5 a 2 por segundo, conforme o tipo. É o principal ajuste de dificuldade.

### Dungeon

- O portal certo da fase 2 leva à dungeon: salas de pedra com paredes de tijolo, sem obstáculos por enquanto.
- Chegar lá conta como vitória. O relógio para, aparece um aviso de vitória e o jogador continua andando pela dungeon. Esc volta ao menu.

### Dano e morte

- Depois de levar dano, o jogador fica 0,5 s invulnerável.
- Ao morrer, volta em 2 s ao início da fase, com HP cheio e 1,5 s de invulnerabilidade.

## Magias (PvP)

Teclas **1 a 6** escolhem a magia; o **botão direito** lança na direção do mouse. Um anel
tracejado mostra o alcance da magia escolhida. Os projéteis acertam **qualquer um, inclusive o
próprio time** (fogo amigo), menos quem lançou. Os números ficam em `src/config.ts` (`spells`).

Depois de usada, a magia fica **bloqueada** durante a recarga: o espaço dela na barra fica cinza
com a contagem regressiva em segundos no meio, e tentar usá-la antes disso faz o espaço piscar em
vermelho. Por enquanto, **todas têm 15 s de recarga**.

| Tecla | Magia | Efeito | Alcance | Recarga |
| --- | --- | --- | --- | --- |
| 1 | Gancho | Projétil; puxa a vítima até a frente de quem lançou e a prende 1,2 s (pode usar magia, não anda) | 380 | 15 s |
| 2 | Cura | 30% da vida de quem estiver sob o mouse (até 320 de distância) ou de quem lançou | 320 | 15 s |
| 3 | Rajada | Projétil; empurra 160 na direção do tiro e causa 10 de dano | 450 | 15 s |
| 4 | Fumaça | Projétil que explode no ponto mirado: nuvem de 5 s; quem está dentro só enxerga um círculo em volta de si | 420 | 15 s |
| 5 | Fogo | Projétil; 25 de dano | 450 | 15 s |
| 6 | Marca | Projétil; marca um X onde acertou, deixa rastro e devolve a vítima ao X depois de 2,5 s | 450 | 15 s |

Obstáculos e magias se somam: a Rajada empurra para cima do gelo, o Gancho puxa alguém para
trás, a Marca desfaz o caminho andado.

**Avisos de morte** (canto superior esquerdo): "[jogador] matou [vítima]" quando alguém acertou
uma magia na vítima até 4 s antes da morte (conta morrer no gelo logo depois de ser empurrado,
puxado ou marcado); "[vítima] morreu" quando foi só o percurso. Aliados em branco, rivais em
vermelho.

## Bots e vitória

- **Jogar contra bots:** 3 bots, cada um no seu time. Eles seguem o percurso desviando do gelo
  avisado, tentam os portais da fase 2 um a um, usam as magias em quem estiver ao alcance e se
  curam com pouca vida. Em testes, terminam a corrida em cerca de 4 minutos.
- **Vitória:** vence o primeiro time com **todos** os membros na dungeon. Se for o seu, aparece a
  vitória e você continua andando pela dungeon; se for outro, aparece a derrota.

## Multiplayer online

- **Servidor autoritativo** (`server/`): roda a mesma simulação (`src/sim/`) a 60 passos/s e envia o
  estado 20 vezes por segundo, junto com os eventos (acertos, mortes, portais) para efeitos, sons
  e avisos. O **portal certo nunca sai do servidor**.
- **Cliente:** envia só comandos (andar até um ponto, lançar magia) e desenha uma cópia local da
  partida que cada atualização sobrescreve, suavizando entre as duas últimas. Ainda **sem
  predição**: o próprio boneco responde depois de um ping de ida e volta.
- **Salas:** times Azul, Vermelho, Verde e Amarelo (mais espectadores). O admin (★) escolhe o
  tamanho do time (solo, dupla, trio), o tempo e de 0 a 3 bots (cada bot num time próprio), e
  inicia ou para a partida. Quem entra no meio de uma partida assiste.
- **Fim:** vence o primeiro time inteiro na dungeon; o resultado aparece para todos e, 8 s
  depois, todos voltam para a sala.

## Mapas

Medidas em unidades do mundo:

| | Fase 1 · Caracol | Fase 2 · Zigue-zague |
| --- | --- | --- |
| Largura do corredor | 140 | 140 |
| Distância entre faixas | 250 (110 de vazio) | 260 (120 de vazio) |
| Início | Ponta direita da tela | Ponta direita da tela; o 1º corredor sobe |
| Trechos | W 1500 → S 1000 → E 1250 → N 750 → W 1000 → S 500 → E 750 | 5 retas de 900 ligadas por trechos de 260, e um salão com 3 portais (dois na entrada, um ao fundo no meio) |
| Obstáculos | Gelo pequeno (retas 1–2), gelo grande (3–4), lâminas (5–7) | Gelo grande, lâminas e misto, aumentando ao longo do caminho |

Os mapas são definidos como uma sequência de movimentos em `src/sim/course.ts`, então dá para ajustá-los ou criar outros facilmente.

## Roteiro

1. ✅ Protótipo offline das duas fases, lentidão, empurrão e a dungeon depois do portal certo.
2. Ajustar a dificuldade jogando: tempo, densidade, dano.
3. Fechar as decisões em aberto, principalmente o PvP.
4. Magias de PvP e bots de treino.
5. ✅ Multiplayer: salas, times (solo, dupla, trio), servidor autoritativo, chat, bots online.
   Próximos: predição do próprio movimento, ping na tela, Docker e deploy na VPS.
6. Arte: sprites isométricos (personagem animado, portal, gelo, cenário) e sons.
