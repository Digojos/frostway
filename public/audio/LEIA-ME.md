# Músicas e sons

Os sons usados pelo jogo são escolhidos em `src/config.ts` (seção `audio`): cada evento aponta
para um arquivo desta pasta. Para trocar um som, basta mudar o caminho lá. Qualquer formato que o
navegador toque serve (`.wav`, `.mp3`, `.ogg`). Arquivos que faltarem só deixam aquele som mudo.

## Acervo

Esta pasta guarda **só os sons em uso**: tudo o que está aqui vai para o git, para a imagem
Docker e para o servidor. Os pacotes completos ficam fora do projeto, em `C:\repos\gaming\_sons`
(o pacote atual está em `_sons\pacote-sfx`).

Para usar um som novo, copie o arquivo do acervo para cá mantendo a mesma subpasta
(ex.: `_sons\pacote-sfx\UI\pop_1.wav` → `public\audio\UI\pop_1.wav`) e aponte o caminho no `config.ts`.

## Escolhas atuais

| Evento | Arquivo |
| --- | --- |
| Fundo dos mapas de gelo (loop) | `Environment/ambient_wind.wav` |
| Fundo da dungeon (loop) | `Environment/water_dripping.wav` |
| Gelo sai do chão perto de você | `Combat and Gore/crunch_quick.wav` |
| Salsicha sai da parede perto de você | `Materials/stone_push_short.wav` |
| Você é atingido pelo gelo do chão | `Combat and Gore/crunch.wav` |
| Você é atingido e empurrado pela salsicha | `Combat and Gore/kick.wav` |
| Morte | `Musical Effects/grand_piano_negative.wav` |
| Renascer | `Musical Effects/grand_piano_chime_quick.wav` |
| Portal que leva adiante (fase 2 ou dungeon) | `Musical Effects/grand_piano_level_start.wav` |
| Portal errado | `Musical Effects/grand_piano_negative_long.wav` |
| Vitória | `Musical Effects/grand_piano_level_complete.wav` |
| Tempo esgotado | `Musical Effects/grand_piano_defeated.wav` |
| Passos na neve (mapas de gelo) | `Footsteps/digital/digital_footstep_snow_1..4.wav` |
| Passos na pedra (dungeon) | `Footsteps/foley_footstep_concrete_1..4.wav` |

Os sons "musicais" usam todos o piano (`grand_piano_*`) para manter um estilo só. A pasta
`Musical Effects` tem as mesmas variações em outros instrumentos (harpsichord, music_box,
vibraphone, 8_bit...), caso queira trocar o clima.

## Música de fundo de verdade

O pacote atual só tem efeitos. Para uma trilha musical, coloque o arquivo aqui e aponte
`music.ice` / `music.dungeon` no `config.ts`. Fontes gratuitas:
[OpenGameArt](https://opengameart.org), [itch.io](https://itch.io/game-assets/free/tag-music),
[Pixabay Music](https://pixabay.com/music/), [Incompetech](https://incompetech.com).
Veja a licença de cada arquivo (algumas pedem crédito ao autor). Músicas de outros jogos têm
direitos autorais e não devem ir para o jogo publicado.
