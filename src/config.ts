/**
 * Ajustes do jogo, todos num lugar só.
 *
 * Unidades:
 * - tempos em segundos;
 * - distâncias em unidades do mundo (o corredor tem 140 de largura);
 * - velocidades em unidades por segundo;
 * - slow é a fração da velocidade perdida (0.45 = 45% mais lento).
 *
 * Depois de mudar, o navegador recarrega sozinho com o `npm run dev` rodando.
 */
export const CONFIG = {
  match: {
    /** Tempo para atravessar as duas fases. */
    timeLimitSeconds: 1200,
  },

  player: {
    speed: 156,
    maxHp: 100,
    /** Tempo morto antes de voltar ao início da fase. */
    respawnSeconds: 5,
    /** Invulnerabilidade ao renascer ou ao trocar de fase. */
    respawnInvulnSeconds: 1.5,
    /** Invulnerabilidade depois de ser atingido, para um obstáculo não acertar várias vezes seguidas. */
    hitInvulnSeconds: 0.5,
    /** Quanto tempo o corpo fica no chão depois de morrer (some aos poucos no final). */
    corpseSeconds: 8,
  },

  /**
   * Magias (teclas 1 a 6 escolhem, botão direito lança). Projéteis acertam qualquer um,
   * inclusive o próprio time (fogo amigo), menos quem lançou.
   * `range` = alcance, `speed` = velocidade do projétil, `radius` = tamanho do projétil.
   */
  spells: {
    /** Puxa quem acertar até a frente de quem lançou e prende no lugar. */
    hook: { range: 380, speed: 900, radius: 10, cooldownSeconds: 15, pullSpeed: 720, rootSeconds: 1.2 },
    /** Cura quem estiver sob o mouse (dentro do alcance) ou, se não houver ninguém, quem lançou. */
    heal: { range: 320, percent: 0.3, cooldownSeconds: 15 },
    /** Empurra forte na direção do tiro. */
    gust: { range: 450, speed: 700, radius: 14, cooldownSeconds: 15, damage: 10, knockback: 160 },
    /** Explode numa nuvem que tira a visão de quem estiver dentro. */
    smoke: {
      range: 420,
      speed: 600,
      radius: 10,
      cooldownSeconds: 15,
      cloudRadius: 110,
      cloudSeconds: 5,
      /** A cegueira continua por um instante depois de sair da nuvem. */
      blindLingerSeconds: 0.5,
    },
    fire: { range: 450, speed: 750, radius: 12, cooldownSeconds: 15, damage: 25 },
    /** Marca um X onde acertou; a vítima volta para o X depois de `returnSeconds`. */
    mark: { range: 450, speed: 800, radius: 11, cooldownSeconds: 15, returnSeconds: 2.5 },
  },

  /** Avisos de morte no canto superior esquerdo. */
  killFeed: {
    /**
     * Quem acertou uma magia na vítima até este tempo antes da morte leva o crédito,
     * mesmo que quem matou tenha sido o gelo (ex.: empurrado pela Rajada para cima do gelo).
     */
    creditSeconds: 4,
    /** Quanto tempo cada aviso fica na tela. */
    showSeconds: 6,
    /** Máximo de avisos ao mesmo tempo. */
    maxEntries: 5,
  },

  /** Bots do modo "Jogar contra bots". */
  bots: {
    count: 3,
    /** Chance por segundo de um bot tentar usar uma magia num alvo ao alcance. */
    castsPerSecond: 0.8,
    /** Abaixo desta vida (0 a 1), o bot tenta se curar. */
    healBelow: 0.45,
  },

  /** Gelo que sai do chão (círculo azul de aviso, depois cristais). */
  groundIce: {
    damage: 30,
    slow: 0.45,
    slowSeconds: 2,
    /** Raio nas duas primeiras retas da fase 1. */
    smallRadius: 32,
    /** Raio a partir da 2ª curva da fase 1 e na fase 2. */
    bigRadius: 54,
    warnSeconds: 0.9,
    activeSeconds: 0.37,
    fadeSeconds: 0.47,
    /** Parte dos gelos que mira onde o jogador vai estar (0 a 1). */
    targetedShare: 0.4,
    /** Quantos surgem por segundo em cada reta ocupada (em média). */
    spawnPerSecond: { small: 1.75, big: 1.6 },
  },

  /** Gelo em forma de salsicha que sai da parede até o meio do corredor. */
  wallIce: {
    damage: 35,
    slow: 0.2,
    slowSeconds: 2,
    /** Distância do empurrão (para trás ou para frente, conforme o lado do contato). */
    knockback: 90,
    /** Grossura da salsicha. */
    thickness: 46,
    warnSeconds: 0.7,
    extendSeconds: 0.15,
    holdSeconds: 0.6,
    retractSeconds: 0.23,
    spawnPerSecond: 1.5,
  },

  /** Trechos "mistos" da fase 2 alternam gelo do chão (grande) e da parede. */
  mixedSpawnPerSecond: 2,

  /**
   * Música e efeitos sonoros. Os caminhos são relativos à pasta `public/`
   * (veja `public/audio/LEIA-ME.md`). Se um arquivo não existir, só aquele som fica mudo.
   */
  audio: {
    /** Volume inicial (0 a 1). O jogador ajusta no menu e a escolha fica salva no navegador. */
    musicVolume: 0.5,
    sfxVolume: 0.7,
    /** Tempo da transição entre músicas ao trocar de mapa. */
    musicFadeSeconds: 1.2,
    /** Obstáculos mais longe que isso (em unidades do mundo) não fazem barulho. */
    hazardHearingDistance: 700,

    /** Passos do seu personagem: um a cada `stepDistance` andado, sorteando uma das variações. */
    footsteps: {
      stepDistance: 46,
      /** Volume dos passos em relação ao volume de efeitos (0 a 1). */
      volume: 0.45,
      ice: [1, 2, 3, 4].map((n) => `audio/Footsteps/digital/digital_footstep_snow_${n}.wav`),
      dungeon: [1, 2, 3, 4].map((n) => `audio/Footsteps/foley_footstep_concrete_${n}.wav`),
    },

    /** Som de fundo por tipo de mapa, tocando em loop. */
    music: {
      ice: 'audio/Environment/ambient_wind.wav',
      dungeon: 'audio/Environment/water_dripping.wav',
    },

    sfx: {
      /** Gelo saindo do chão. */
      iceErupt: 'audio/Combat and Gore/crunch_quick.wav',
      /** Salsicha saindo da parede. */
      wallErupt: 'audio/Materials/stone_push_short.wav',
      /** Você foi atingido pelo gelo do chão. */
      hitGround: 'audio/Combat and Gore/crunch.wav',
      /** Você foi atingido (e empurrado) pela salsicha. */
      hitWall: 'audio/Combat and Gore/kick.wav',
      death: 'audio/Musical Effects/grand_piano_negative.wav',
      respawn: 'audio/Musical Effects/grand_piano_chime_quick.wav',
      /** Entrou num portal que leva adiante (fase 2 ou dungeon). */
      portal: 'audio/Musical Effects/grand_piano_level_start.wav',
      wrongPortal: 'audio/Musical Effects/grand_piano_negative_long.wav',
      victory: 'audio/Musical Effects/grand_piano_level_complete.wav',
      timeout: 'audio/Musical Effects/grand_piano_defeated.wav',
      // Magias (tocam para quem estiver perto, mais baixo quanto mais longe).
      hookCast: 'audio/Weapons/sword_unsheath.wav',
      hookHit: 'audio/Materials/metal_clang.wav',
      heal: 'audio/Items/heart_collect.wav',
      gust: 'audio/Other/whoosh_2.wav',
      smokeBurst: 'audio/Environment/air_burst.wav',
      fireCast: 'audio/Environment/fire_lighting.wav',
      fireHit: 'audio/Retro/explosion_small.wav',
      markCast: 'audio/Musical Effects/grand_piano_mystery.wav',
      recall: 'audio/Retro/power_down.wav',
    },
  },
};
