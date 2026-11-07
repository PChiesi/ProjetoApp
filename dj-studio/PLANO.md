# 🎧 Pista — software de DJ para aprender a mixar (plano de desenvolvimento)

> Nome: **Pista**. Público-alvo: alguém que **sonha em ser DJ e está começando do zero**.
> O objetivo não é competir com Serato/Rekordbox em recursos, e sim ser **o melhor lugar para aprender**:
> funcional de verdade (dá para tocar um set), mas que **ensina enquanto ela toca** e cresce junto com ela.

---

## 1. Visão e princípios de UX

| Princípio | O que significa na prática |
|---|---|
| **Som em 10 segundos** | Abriu o app → já tem 2 músicas de demonstração carregadas → aperta ▶ e ouve algo. Nada de tela de configuração antes da primeira música. |
| **Revelação progressiva** | A interface começa com o essencial (play, volume, crossfader, sync). Os controles avançados aparecem conforme ela desbloqueia lições ou liga o "Modo Pro". Nunca 80 botões na primeira tela. |
| **Ver o som** | Tudo que o ouvido de iniciante ainda não percebe vira visual: batidas alinhadas/desalinhadas, compassos e frases (contagem 1-2-3-4), tom compatível, volume estourando. |
| **Errar sem medo** | Desfazer (Ctrl+Z) para loops/cues, "ensaio" com fone (pré-escuta) antes de soltar no público, limitador automático que impede distorção. Nenhuma ação destrói nada. |
| **Feedback imediato e gentil** | Ao terminar uma transição: "Transição limpa! As batidas ficaram alinhadas 96% do tempo." — reforço positivo, nunca punição. |
| **Mesma linguagem dos equipamentos reais** | Layout espelha uma controladora de 2 canais (estilo DDJ-FLX4/Mixtrack). O que ela aprender aqui transfere para a cabine de verdade. |
| **Toque, mouse, teclado e controladora** | Todo controle funciona com arrastar do mouse, toque, atalho de teclado e MIDI. |
| **Acessível** | Contraste alto, alvos de toque ≥ 44 px, cores nunca como única informação (sempre ícone/forma junto), textos em português. |

---

## 2. Plataforma e stack (recomendação)

**Recomendação: app web (PWA) com React + TypeScript + Web Audio API, empacotado como desktop com Tauri.**

| Camada | Escolha | Por quê |
|---|---|---|
| Interface | React 18 + TypeScript + Vite | Ecossistema enorme, componentes reutilizáveis (knob, fader, waveform). |
| Estado | Zustand | Simples e rápido; separado do motor de áudio. |
| Motor de áudio | Web Audio API + **AudioWorklet** | Roda em thread de áudio dedicada, latência baixa (~10 ms), sem plugins. |
| Time-stretch / key lock | SoundTouch (porta WASM) ou Rubber Band (WASM) | Mudar BPM sem virar "voz de esquilo". |
| Análise (BPM, grid, tom, waveform) | Web Worker + Essentia.js (WASM) | Análise sem travar a interface; Essentia detecta BPM, tom (key) e energia. |
| Separação de stems (fase 4) | Modelo Demucs/HTDemucs via ONNX Runtime Web (WebGPU) | Isolar vocal/batida/baixo/instrumentos para remixar. |
| Desenho das ondas | Canvas 2D / WebGL (PixiJS) | 60 fps com duas waveforms rolando. |
| Biblioteca | IndexedDB (Dexie) + File System Access API | Guarda análises e cues localmente; nada vai para servidor. |
| Controladora | Web MIDI API | Plug-and-play com controladoras USB. |
| Desktop | Tauri 2 | Instalador leve (~10 MB) para Windows/macOS, acesso a pastas de música. |
| Testes | Vitest + Playwright | Lógica de áudio com testes offline (OfflineAudioContext), UI com e2e. |

Alternativa considerada: C++/JUCE (latência mínima, padrão da indústria) — descartada para o começo porque
torna a interface muito mais lenta de iterar, e UX é o diferencial deste projeto.

---

## 3. Arquitetura

```
┌───────────────────────────── UI (React, thread principal) ─────────────────────────────┐
│  Biblioteca │ Deck A │ Mixer │ Deck B │ FX │ Sampler │ Coach (lições e dicas)           │
└───────▲──────────────────────────────▲───────────────────────────────▲────────────────┘
        │ estado (Zustand)             │ comandos / meters             │ eventos de aprendizado
┌───────┴────────┐          ┌──────────┴───────────┐          ┌────────┴─────────┐
│ Biblioteca     │          │ AudioEngine          │          │ Coach Engine     │
│ IndexedDB      │          │  Deck ×2 (Worklet)   │─────────▶│ regras + métricas│
│ análise cache  │          │  Mixer (EQ, filtro,  │  métricas│ (alinhamento,    │
└───────▲────────┘          │  ganho, crossfader)  │  em tempo│  clipping, frase)│
        │                   │  FX, Sampler,        │  real    └──────────────────┘
┌───────┴────────┐          │  Master + Fone (cue) │
│ Analyzer Worker│          │  Recorder            │
│ BPM, grid, tom,│          └──────────▲───────────┘
│ waveform, stems│                     │
└────────────────┘          ┌──────────┴───────────┐
                            │ Entradas: teclado,   │
                            │ toque, MIDI mapping  │
                            └──────────────────────┘
```

- **AudioEngine** é um módulo isolado, sem React, com API do tipo `deck.play()`, `deck.setTempo()`, `mixer.setEq('A','low',-12)`. Assim é testável e a UI nunca trava o som.
- **Duas saídas**: master (caixa de som) e pré-escuta (fone), quando o computador tem placa com 4 canais ou controladora com placa embutida. Sem isso, modo "split" (fone mono em um lado).
- **Coach Engine** observa as métricas do motor (diferença de fase entre decks, picos de volume, posição na frase) e dispara dicas/avaliações.

---

## 4. Funcionalidades por nível

### Nível 1 — "Primeira mixagem" (MVP)
- 2 decks com waveform colorida (graves em vermelho, médios em verde, agudos em azul — padrão da indústria).
- Play/Pause, Cue, **Sync**, pitch/tempo (±8% / ±16%), key lock.
- Mixer: ganho, EQ 3 bandas com "kill", filtro (passa-baixa ↔ passa-alta em 1 knob), fader de canal, **crossfader** com curvas.
- VU meters com aviso de clipping + limitador no master.
- Biblioteca: arrastar arquivos (MP3, WAV, FLAC, AAC/M4A), análise automática de BPM, tom e grid.
- **Pack de músicas livres de direitos** incluído para começar sem procurar nada.
- Gravação do set em WAV/MP3.

### Nível 2 — "Controle criativo"
- **Hot cues** (8 por música, coloridos, com nome).
- **Loops**: auto-loop de 1/4 a 32 batidas, loop roll, dobrar/dividir, mover loop.
- Beat jump, nudge (empurrar/puxar a batida), ajuste manual do grid.
- **Efeitos** sincronizados com o BPM: eco, reverb, flanger, phaser, bitcrusher, gate, brake, spinback.
- **Sampler** com 8 pads (buzina, vocal, risers, drops) sincronizado ao tempo.

### Nível 3 — "Seleção e set"
- **Mixagem harmônica**: roda de Camelot, músicas compatíveis destacadas em verde na biblioteca.
- Sugestão "próxima música" por BPM ± tom ± energia.
- Playlists / "crates", histórico de sets, tags de energia e humor.
- Visualização de **frases** (blocos de 16/32 batidas, intro/drop/breakdown/outro).

### Nível 4 — "Remix"
- **Stems**: separar vocal / batida / baixo / melodia e ligar/desligar cada um no deck (acapella na hora!).
- Modo **Remix Studio**: linha do tempo simples de 4 pistas para montar mashups (vocal da música A sobre batida da B), exportar em WAV.
- Loops gravados ao vivo (capturar 4 batidas de um deck para um pad do sampler).

### Estúdio (edição de faixas)
- Cortar, estender, apagar e reordenar partes da música; fades; inserir sons (vinheta, efeitos sonoros) e efeitos em trechos; exportar. Especificação completa na **seção 13**.

### Transversal
- Mapeamento MIDI com "aprender" (mexe no botão da controladora → associa ao controle na tela) + perfis prontos para controladoras populares.
- Atalhos de teclado completos (overlay com `?`).
- Tema escuro (padrão de cabine) e claro; modo tela cheia.

---

## 5. O diferencial: **Modo Aprender** (Coach)

A parte mais importante para o objetivo dela.

### 5.1 Trilha de lições (gamificada, curta, prática)
Cada lição tem: objetivo → demonstração animada (30 s) → prática guiada na própria interface (os controles relevantes ficam destacados, o resto esmaece) → avaliação automática → estrela/conquista.

| # | Lição | O que o Coach mede |
|---|---|---|
| 1 | Conhecendo o deck: play, cue, volume | Usou o cue para voltar ao ponto. |
| 2 | O crossfader e a primeira transição | Transição sem silêncio e sem pico de volume. |
| 3 | O que é BPM? Contando batidas | Bate palma/tecla no tempo (teste de ritmo). |
| 4 | **Beatmatching com Sync** | Transição com batidas alinhadas. |
| 5 | Beatmatching **de ouvido** (sem sync) | % do tempo com fase alinhada (< 10 ms). |
| 6 | EQ: trocando os graves | Nunca dois graves cheios ao mesmo tempo. |
| 7 | Frases: entrar no "1" | Iniciou a música no começo de uma frase. |
| 8 | Loops para estender uma intro | Loop de 8/16 batidas sem quebrar o ritmo. |
| 9 | Hot cues e saltos criativos | — |
| 10 | Efeitos com bom gosto (eco de saída, filtro) | Efeito ligado/desligado em ponto de frase. |
| 11 | Mixagem harmônica | Tons compatíveis na roda de Camelot. |
| 12 | Montando um set de 30 minutos | Curva de energia + gravação. |
| 13+ | Remix com stems, mashups, scratch básico | — |

### 5.2 Ajudas visuais durante a mixagem (podem ser desligadas)
- **Medidor de alinhamento**: duas fileiras de "pílulas" de batida, uma por deck; quando batem juntas ficam verdes; uma setinha indica "acelere" ou "desacelere".
- **Contador de frase**: `1 · 2 · 3 · 4 | compasso 3 de 8` em cima de cada deck, com aviso "frase nova em 4 batidas".
- **Semáforo de tom**: verde (combina), amarelo (arriscado), vermelho (vai dissonar).
- **Alerta de graves somados** e **alerta de clipping** com dica de correção ("abaixe o ganho do deck B").

### 5.3 Feedback pós-set
Ao parar a gravação: relatório com linha do tempo das transições, nota de cada uma (alinhamento, volume, EQ, frase),
momentos para ouvir de novo e **uma** sugestão principal para treinar ("Tente cortar o grave do deck que entra").

### 5.4 Progresso
Mapa de habilidades, sequência de dias praticando, conquistas ("Primeira transição limpa", "10 sets gravados").
Tudo local, sem conta obrigatória.

---

## 6. Interface — layout e fluxos

### 6.1 Tela principal (Modo Iniciante)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ 🎧 Pista     [Aprender] [Tocar] [Remix]           ● REC  00:00   Modo: Iniciante ▾│
├──────────────────────────────────────────────────────────────────────────────────┤
│  ▁▂▅▇█▇▅▃▂▁▂▅▇█▇▅▃▂ DECK A (waveform rolando, playhead central) ▁▂▅▇█▇▅▃▂▁▂▅▇   │
│  ▁▂▃▅▇▅▃▂▁▂▃▅▇▅▃▂▁ DECK B ▁▂▃▅▇▅▃▂▁▂▃▅▇▅▃▂▁▂▃▅▇▅▃▂▁▂▃▅▇▅▃▂▁▂▃▅▇▅▃▂▁            │
│           ● ● ● ●   ● ● ● ●   ← medidor de alinhamento (verde = no tempo)        │
├─────────────────────────┬─────────────────────┬──────────────────────────────────┤
│ DECK A                  │        MIXER        │                  DECK B          │
│ [capa] Música · Artista │  GRAVE  ◯     ◯     │  Música · Artista [capa]         │
│ 124.0 BPM · 8A 🟢       │  FILTRO ◯     ◯     │  126.0 BPM · 9A 🟢               │
│ 1·2·3·4  compasso 3/8   │         ▮     ▮     │  1·2·3·4  compasso 1/8           │
│ ┌────┐ ┌────┐ ┌──────┐  │  VOL    ▮     ▮     │  ┌──────┐ ┌────┐ ┌────┐         │
│ │ CUE│ │ ▶ ‖│ │ SYNC │  │         ▮▮    ▮▮    │  │ SYNC │ │ ▶ ‖│ │ CUE│  TEMPO  │
│ └────┘ └────┘ └──────┘  │   A ◀━━━━●━━━━▶ B   │  └──────┘ └────┘ └────┘   ▮     │
├─────────────────────────┴─────────────────────┴──────────────────────────────────┤
│ 💡 Coach: "O deck B está um pouco mais rápido — clique em SYNC ou baixe o tempo." │
├──────────────────────────────────────────────────────────────────────────────────┤
│ BIBLIOTECA  🔍 buscar   [Todas] [Combinam com A ✓] [Recentes]                     │
│  ▶ Título            Artista       BPM   Tom   Energia  Duração                   │
│  ⋮  (arrastar para o deck A ou B, ou botões A/B na linha)                         │
└──────────────────────────────────────────────────────────────────────────────────┘
```

No **Modo Intermediário** aparecem: EQ completo (grave/médio/agudo), hot cues, loops, FX.
No **Modo Pro**: todos os controles, sampler, beat jump, grid manual, pré-escuta, mapa MIDI.

### 6.2 Fluxos-chave
1. **Primeiro uso (onboarding de 60 s)**: "Qual seu nome?" → "Já mexeu com DJ? Nunca / Um pouco / Sim" (define o modo) → músicas demo já carregadas → tooltip único: "Aperte ▶ no deck A". Pronto.
2. **Carregar música**: arrastar arquivo/pasta para a janela → aparece na biblioteca com spinner "analisando batidas…" → arrastar para um deck (o deck "acende" quando a música é arrastada por cima).
3. **Transição guiada** (botão "Me ajude nessa transição"): o Coach destaca, em sequência, sync → contagem até a frase → subir fader → trocar grave → crossfader.
4. **Gravar e revisar**: REC → tocar → parar → relatório do set → salvar/compartilhar o arquivo.

### 6.3 Microinterações que fazem diferença
- Knobs: arrastar vertical, roda do mouse, **duplo clique volta ao centro**, valor aparece ao tocar.
- Faders com "ímã" no 0 dB e no centro.
- Botões que piscam no tempo da música (play pulsa no BPM).
- Waveform: pinça/roda para zoom, arrastar para "empurrar" a música (como mexer no prato).
- Sons de UI nunca vão para o master.

### 6.4 Identidade visual
Fundo escuro (cabine), um tom de destaque por deck (ex.: A = ciano, B = magenta), tipografia grande e legível
(Inter / Space Grotesk), animações curtas (≤150 ms) e nada de brilho excessivo que canse a vista em sessões longas.

---

## 7. Roteiro (marcos)

> Reorganizado depois da pesquisa de mercado (seção 11). A ordem segue o backlog priorizado da seção 12.

| Fase | Entrega | Critério de pronto | Status |
|---|---|---|---|
| **0. Fundação** | Projeto, motor de áudio, testes, arquivo único para Windows. | Toca e mostra a onda. | ✅ feito |
| **1. MVP "Primeira mixagem"** | 2 decks, mixer, crossfader, BPM/grid, sync, biblioteca, gravação, músicas demo. | Ela grava uma mixagem de 2 músicas sem ajuda. | ✅ feito (falta key lock → fase 2) |
| **2. Fundamentos que todo software tem** (P0) | Key lock, detecção de tom, hot cues, loops, quantize, auto gain, biblioteca salva, fone/pré-escuta, controladora DDJ-FLX4. | Tocar um set de 20 min na controladora usando cues e loops. | próximo |
| **3. Estúdio v1 + criatividade** (P1) | **Editor de faixas** (cortar, estender, apagar, fades, inserir sons e efeitos, exportar), efeitos, sampler com vinheta, lições guiadas 1–12. | Ela faz a própria "versão estendida" de uma música e toca no set. | |
| **4. Inteligência** (P2) | Stems, transições prontas, sugestão da próxima música, playlists/histórico, Automix que explica, relatório pós-set. | Set de 30 min com transições entre pop, rock e funk. | |
| **5. Remix** (P3) | Estúdio multipista (mashup / "Versão funk"), batidas prontas (tamborzão), grid dinâmico, slicer, Flux. | Exportar um mashup próprio. | |
| **6. Desktop** | Instalador Windows com Tauri, atalho na área de trabalho, pastas de música. | Instalar com duplo clique. | |

**Teste com usuária real desde a fase 1**: a cada entrega, observar ela usando (sem explicar nada), anotar onde travou, corrigir. Esse ciclo é o que torna a UX boa.

---

## 8. Riscos e cuidados

| Risco | Mitigação |
|---|---|
| Latência/engasgos no navegador | AudioWorklet + buffers pré-decodificados; Tauri no desktop; medir em notebook modesto. |
| Detecção de BPM errada (meio/dobro) | Botões "÷2 / ×2" e "tap tempo"; ajuste manual do grid. |
| Separação de stems pesada | Processar em segundo plano e guardar em cache; só em máquinas com WebGPU; opcional. |
| Saída de fone separada | Depende da placa/controladora; modo split como plano B e explicação clara na tela. |
| Direitos autorais | O app só toca arquivos da própria usuária; pack demo apenas com músicas livres (CC0/CC-BY com crédito). Sem integração com streaming no início. |
| Escopo crescer demais | Cada fase só começa quando a anterior foi usada de verdade por ela. |

---

## 9. Decisões tomadas

| Tema | Decisão | Consequência no produto |
|---|---|---|
| **Onde vai usar** | Notebook **Windows** | Alvo de tela 1366×768 e maiores; fontes Segoe UI; versão de teste = um único `Pista.html` que abre com duplo clique no Edge/Chrome; instalador com Tauri (WebView2) na fase 6. |
| **Controladora** | Vai comprar → recomendação: **Pioneer DDJ-FLX4** | Layout padrão Pioneer (o mesmo das cabines/CDJs dos clubes), 2 canais, placa de som embutida com saída de fone separada (resolve a pré-escuta), muito material de estudo em português. Alternativa mais barata: **Hercules DJControl Inpulse 200 MK2** (tem luzes que ensinam a alinhar a batida). O mapeamento MIDI da FLX4 sobe para a **fase 2**. |
| **Estilos** | **Pop, rock e funk brasileiro** | Músicas demo, lições e algoritmos pensados para esses três (detalhes abaixo). |
| **Nome** | **Pista** | Tela de boas-vindas pergunta o nome dela e o app a cumprimenta ("bora tocar, …!"). |
| **Repositório** | Fica neste repositório, pasta `dj-studio/` | Pode virar repositório próprio depois, sem mudar nada no código. |

### 9.1 O que cada estilo pede do software

**Funk brasileiro**
- Faixas típicas: **~130 BPM** (tamborzão/funk carioca) e **~150 BPM** (mandelão/"150 BPM"), além de funk melody mais lento.
- A levada do tamborzão é **sincopada** — engana detectores de BPM simples. O detector da Pista usa autocorrelação no compasso inteiro e um modelo "bumbo no 1, caixa no 2 e 4" (testado com tamborzão e 150 sintetizados).
- 130 → 150 é longe demais para o SYNC (+15%). Em vez de esconder isso, o app **explica** e ensina as técnicas do funk: **corte seco no "1"**, saída com eco e a "puxada".
- **Vinheta**: todo DJ de funk tem a sua. Fase 3: gravar a própria vinheta pelo microfone (ou importar) num pad do sampler, já no tempo da música.
- Fase 5: modelo **"Versão funk"** no Remix Studio — acapella de uma música pop sobre um tamborzão, o remix mais brasileiro que existe.

**Rock**
- Muito rock é gravado com **bateria ao vivo, sem metrônomo**: o BPM oscila. O app mede a "regularidade" e avisa quando o grid pode escorregar; fase 4 traz **grid dinâmico** (BPM que varia ao longo da música).
- Lição dedicada a **alinhar de ouvido** (◀ ▶), porque o SYNC sozinho não salva uma faixa ao vivo.
- Transições típicas: entrar no refrão, saída com eco/reverb, filtro.

**Pop**
- Estrutura clara (verso/refrão) → ótima para aprender **frases** e entrar no "1".
- Mixagem harmônica faz muita diferença em músicas com vocal → roda de Camelot e cores de tom na biblioteca.

### 9.2 Lições ajustadas aos estilos dela
Acrescentam-se à trilha da seção 5: **"Corte seco no funk"**, **"Subindo a energia: 130 → 150"**, **"Minha vinheta"**, **"Rock ao vivo: alinhando de ouvido"**, **"Do pop pro funk"** (transição entre gêneros) e **"Versão funk"** (remix com stems).

---

## 10. Status e próximos passos

### Já feito (protótipo funcional em `dj-studio/app`)
- [x] Fase 0 — projeto React + TypeScript + Vite, testes (Vitest), build em arquivo único para Windows.
- [x] 2 decks: tocar/pausar, CUE estilo CDJ, SYNC (com dobro/metade e recusa didática acima de 16%), tempo ±8/±16%, empurrar/frear (◀ ▶), pular batidas, correção do grid (÷2, ×2, ½ batida, mover o "1").
- [x] Mixer: ganho, EQ 3 bandas com corte total, filtro de um botão, volume, crossfader de potência constante, master, medidores e **limitador** (não estoura).
- [x] Ondas rolando em 3 cores (graves/médios/agudos), grid com compassos e **frases**, visão geral clicável, zoom na roda do mouse.
- [x] Detecção de BPM e do "1" do compasso para arquivos dela (MP3/WAV/FLAC/OGG/M4A, arrastar e soltar).
- [x] 4 músicas demo **sintetizadas no próprio app** (livres de direitos): pop 120, rock 124, tamborzão 130 e funk 150, com intro/breakdown/outro em frases de 8 compassos.
- [x] **Coach v1**: medidor de alinhamento, contador 1-2-3-4 / compasso x/8, semáforo de tom, dicas contextuais com o controle destacado na tela, e **nota com estrelas** a cada transição.
- [x] Níveis Iniciante / Intermediário / Pro, boas-vindas com o nome dela, atalhos de teclado, gravação do set.
- [x] **Hot cues** (8 pads coloridos; o salto mantém o ritmo), **loops** de 1/4 a 32 batidas com ½/×2, **quantize** e **auto gain** (níveis Intermediário/Pro).
- [x] **Estúdio v1**: abrir qualquer música (✎ na biblioteca), selecionar compassos arrastando, recortar/copiar/repetir/apagar, paleta de trechos para colar, Intro +8 / Final +8, fades em compassos, seções coloridas (intro/parte/breakdown/outro), modelos "Versão estendida", "Versão rádio" e "Pro baile", desfazer/refazer, ouvir, **salvar na biblioteca** (já toca nos decks) e **baixar WAV**.

### Próximos
1. Testar com ela: abrir o `Pista.html`, deixar ela tocar sem explicar nada, anotar onde travou.
2. Seguir o backlog da **seção 12**: P0 que faltam (key lock, detecção de tom, biblioteca salva, DDJ-FLX4 e fone) e o **Estúdio v2/v3** (inserir sons/vinheta e efeitos em trechos).

---

## 11. Pesquisa de mercado: o que os principais softwares oferecem

Pesquisa feita em novembro de 2026. Fontes no fim da seção.

### 11.1 Quem é quem

| Software | Perfil | Pontos fortes | Pontos fracos para ela |
|---|---|---|---|
| **rekordbox** (AlphaTheta/Pioneer) | O mais usado (34% num censo de DJs de 2026). Padrão das cabines com equipamento Pioneer. | Preparo de músicas para o CDJ, stems de 3 e 4 partes (desde a v7.2.8), **modo Edit** para cortar/estender faixas, "Intelligent Cue", sugestões de músicas relacionadas, nuvem. | Assinatura; o modo Edit fica no plano pago; interface densa para iniciante. |
| **Serato DJ Pro** | 27% dos DJs. Favorito de quem faz scratch e usa controladoras. | Estável, stems com efeitos por stem (Stems FX), licença única; **Serato Studio** para fazer edits e beats e passar para o DJ Pro. | Duas ferramentas separadas para tocar e editar. |
| **VirtualDJ** | ~17%. O mais abrangente; grátis para uso doméstico. | Maior suporte a controladoras, Stems 2.0 em tempo real, **Sandbox** (ensaiar no fone sem o público ouvir), pontos de ação na música (POI). | Visual carregado, muitas opções. |
| **Traktor Pro 4** (Native Instruments) | Mixagem criativa em 4 decks. | Stems, **Remix Decks** (samples no tempo), **Pattern Player** (bateria pronta), **Flux** (brinca e volta no tempo certo), grid flexível. | Curva de aprendizado alta. |
| **djay Pro** (Algoriddim) | Melhor no iPad/celular e para iniciantes. | **Neural Mix** (stems), **Crossfader Fusion** (transições prontas com filtros e efeitos), **Automix AI**, cursos para iniciante, streaming. | Recursos de IA na assinatura. |
| **Mixxx** | Grátis e de código aberto. | Auto DJ, correção do grid, detecção de tom, efeitos encadeados, samplers, MIDI. | Visual e recursos de aprendizado limitados. |

### 11.2 Funcionalidades que aparecem em todos (ou quase)

| # | Funcionalidade | rekordbox | Serato | VirtualDJ | Traktor | djay | Mixxx | Pista |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 1 | BPM, grid e sync | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✅ |
| 2 | EQ 3 bandas, filtro, crossfader | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✅ |
| 3 | Key lock (BPM sem mudar o tom) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ⏳ |
| 4 | Detecção de tom / mixagem harmônica | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | parcial (só demos) |
| 5 | Hot cues (8 por música) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ⏳ |
| 6 | Loops automáticos e loop roll | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ⏳ |
| 7 | Quantize (tudo cai na batida) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ⏳ |
| 8 | Efeitos no tempo (eco, reverb, flanger…) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ⏳ |
| 9 | Sampler / pads | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ⏳ |
| 10 | Stems (vocal, batida, baixo…) | ✓ | ✓ | ✓ | ✓ | ✓ | — | ⏳ |
| 11 | Biblioteca com playlists e histórico | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | parcial |
| 12 | Controladoras MIDI | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ⏳ |
| 13 | Pré-escuta no fone | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ⏳ |
| 14 | Gravação do set | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✅ |
| 15 | Automix | ✓ | — | ✓ | — | ✓ | ✓ | ⏳ |

### 11.3 Diferenciais que valem copiar (adaptados para quem está aprendendo)

| Ideia | De onde vem | Como entra na Pista |
|---|---|---|
| **Modo Edit** (cortar, colar, inserir, apagar, preso ao grid; paleta de trechos) | rekordbox | Base do **Estúdio** (seção 13), mas grátis, mais simples e com sons/efeitos. |
| Edits e beats num app à parte | Serato Studio | Na Pista é **o mesmo app**: uma aba "Estúdio", e a faixa editada vai direto para a biblioteca. |
| **Transições prontas** com filtros e efeitos | djay (Crossfader Fusion) | "Transições prontas" no crossfader, **com explicação** do que cada uma faz, para ela aprender e depois fazer na mão. |
| **Automix** | djay, VirtualDJ, Mixxx | "Automix que explica": o app mixa sozinho e narra o que fez ("baixei o grave do B aqui"). Serve de aula. |
| **Sandbox** | VirtualDJ | "Ensaiar": testa uma transição no fone enquanto a música segue no ar. |
| Músicas relacionadas, cue automático | rekordbox | Sugestão da próxima música e cues automáticos (intro, refrão, outro). |
| **Pattern Player** | Traktor | "Batidas prontas" com kits de **tamborzão, 150 e pop/rock**, para tocar por cima e fazer remix. |
| **Flux** | Traktor | Brincar com cues e scratch sem perder o tempo da música. |
| Stems com efeitos por parte | Serato, Traktor | Eco só no vocal, filtro só na batida. |
| Cursos para iniciante | djay | A Pista já nasce com o Coach e as lições (seção 5). |

### Fontes
- [The Best DJ Software of 2026 — DJ.Studio](https://dj.studio/blog/best-dj-software-2023) e [Pro DJ Software Landscape 2026](https://dj.studio/blog/pro-dj-software-landscape-top-tier) (o DJ.Studio vende o próprio software; usar os rankings com cuidado)
- [Serato vs Rekordbox in 2026 — Digital DJ Pool](https://digitaldjpool.com/blog/serato-vs-rekordbox/)
- [rekordbox v7.2.8 release information](https://rekordbox.com/en/2025/12/rekordbox-v728-release-information/) e [Digital DJ Tips: 4-stem separation](https://www.digitaldjtips.com/rekordbox-v7-2-8-adds-4-stem-separation/)
- [How To Make DJ Edits With Rekordbox Edit Mode — Digital DJ Tips](https://www.digitaldjtips.com/dj-edits-rekordbox-6-1-edit-feature-guide/) e [DJ Mag](https://djmag.com/news/you-can-now-make-your-own-extended-edits-rekordbox-611)
- [Serato DJ Pro](https://serato.com/dj-pro) e [Serato Studio 2.4.0](https://serato.com/studio/downloads/2.4.0)
- [VirtualDJ Software Review 2026 — DJGear2k](https://djgear2k.com/virtual-dj-software-review/)
- [Traktor Pro 4 — Native Instruments](https://native-instruments.com:443/en/products/traktor/dj-software/traktor-pro-4) e [review da MusicTech](https://musictech.com/reviews/dj/native-instruments-traktor-4-pro/)
- [djay — recursos (Algoriddim)](https://www.algoriddim.com/features) e [djay Pro 5 (Engadget)](https://www.engadget.com/ai-joins-you-in-the-dj-booth-with-algoriddims-djay-pro-5-150007224.html)
- [Mixxx — Tech2Geek](https://www.tech2geek.net/mixxx-the-best-free-and-open-source-dj-software-for-windows-macos-and-linux)

---

## 12. Backlog priorizado

Critério: **1)** o que todo DJ usa e ela vai encontrar em qualquer cabine; **2)** o que ela pediu (editar faixas); **3)** o que acelera o aprendizado; **4)** o resto.
Esforço: P = pequeno (dias), M = médio (1–2 semanas), G = grande (3+ semanas).

### P0 — Fundamentos (ninguém leva a sério um software de DJ sem isso)
| # | Funcionalidade | Por que para ela | Esforço | Status |
|---|---|---|---|---|
| 1 | **Key lock** (mudar BPM sem virar "voz de esquilo") | Pop com vocal fica estranho a +4% sem isso. | M | ⏳ |
| 2 | **Detecção de tom** nas músicas dela | Libera as cores de tom e o filtro "Combinam". | M | ⏳ |
| 3 | **Hot cues** (8 por música, coloridos) | Marcar o refrão, o drop, a vinheta. | P | ✅ (falta salvar entre sessões → item 7) |
| 4 | **Loops** (1/4 a 32 batidas, dobrar/dividir, loop roll) | Estender a intro enquanto prepara a próxima. | P | ✅ (loop roll pendente) |
| 5 | **Quantize** (cue/loop/play caem na batida) | Iniciante erra o tempo; quantize perdoa. | P | ✅ |
| 6 | **Auto gain** (volume igual entre músicas) | Funk e rock costumam ter volumes muito diferentes. | P | ✅ |
| 7 | **Biblioteca salva** (músicas, análise e cues ficam entre sessões) | Hoje ela precisa recarregar tudo ao abrir. | M | ⏳ |
| 8 | **Controladora DDJ-FLX4** + saída de fone pela placa dela | Ela vai comprar; é o que transforma em prática real. | M | ⏳ |
| 9 | **Pré-escuta (CUE de fone)** por canal | Ouvir a próxima antes do público. | P (com a FLX4) | ⏳ |

### P1 — Estúdio e criatividade (o pedido dela)
| # | Funcionalidade | Por que para ela | Esforço | Status |
|---|---|---|---|---|
| 10 | **Estúdio v1: editor de faixas** — cortar, estender, apagar, mover, fades, exportar (seção 13) | Fazer a própria versão estendida/rádio/"pro baile". | G | ✅ (MP3 pendente; exporta WAV) |
| 11 | **Estúdio: inserir sons** — vinheta gravada no microfone, efeitos sonoros, sons próprios | Toda DJ de funk tem vinheta. | M | ⏳ |
| 12 | **Estúdio: efeitos em trechos** — eco, reverb, filtro, freio, reverse, gate, volume | Criar viradas e saídas na própria faixa. | M | ⏳ |
| 13 | **Efeitos ao vivo** no tempo da música (eco, reverb, flanger, filtro, freio, spinback) | Todos os softwares têm; essenciais nas transições. | M | ⏳ |
| 14 | **Sampler** com 8 pads (a vinheta dela, buzina, sirene, risers) | Uso ao vivo dos sons do Estúdio. | P | ⏳ |
| 15 | **Trilha de lições** guiadas com progresso (seções 5.1 e 9.2) | O diferencial da Pista. | M | ⏳ |

### P2 — Inteligência que ensina
| # | Funcionalidade | Inspiração | Esforço |
|---|---|---|---|
| 16 | **Stems** (vocal / batida / baixo / melodia) nos decks e no Estúdio | Todos menos Mixxx | G |
| 17 | **Transições prontas** com explicação | djay Crossfader Fusion | M |
| 18 | **Sugestão da próxima música** (BPM, tom, energia, gênero) | rekordbox Related Tracks | P |
| 19 | **Cue automático** (intro, refrão, breakdown, outro) | rekordbox Intelligent Cue | M |
| 20 | **Playlists, histórico de sets** e tags de energia | Todos | P |
| 21 | **Automix que explica** | djay, VirtualDJ, Mixxx | M |
| 22 | **Relatório pós-set** (seção 5.3) | — (diferencial) | M |
| 23 | **Ensaiar** no fone (sandbox) | VirtualDJ | M |

### P3 — Remix e performance avançada
| # | Funcionalidade | Inspiração | Esforço |
|---|---|---|---|
| 24 | **Estúdio multipista**: mashup e modelo "Versão funk" (vocal pop sobre tamborzão) | Serato Studio | G |
| 25 | **Batidas prontas** (kits tamborzão, 150, pop, rock) | Traktor Pattern Player | M |
| 26 | **Grid dinâmico** para rock ao vivo | Traktor flexible beatgrid, djay | M |
| 27 | **Slicer** e **Flux** | Serato, Traktor | M |
| 28 | Efeitos por stem | Serato Stems FX | M |
| 29 | 4 decks | Traktor, VirtualDJ | M |

### P4 — Depois (ou nunca)
Streaming (TIDAL, SoundCloud, Beatport exigem parceria comercial), vinil digital (DVS), vídeo, transmissão ao vivo, nuvem. Nada disso ajuda a aprender agora.

---

## 13. Estúdio — o editor de faixas

**Objetivo:** ela pega uma música e faz a **versão dela**: intro mais longa para mixar, sem a parte chata, com a vinheta no começo, um eco na saída. Inspirado no modo Edit do rekordbox e no Serato Studio, mas pensado para quem nunca abriu um editor de áudio.

### 13.1 Princípios
- **Tudo preso ao grid** (por padrão em compassos; dá para trocar para batidas ou livre). Assim nenhum corte "tropeça" no ritmo.
- **Não destrutivo:** o arquivo original nunca muda. O Estúdio guarda uma "receita" (lista de trechos, sons e efeitos) e só gera áudio ao exportar.
- **Desfazer/refazer ilimitado** (Ctrl+Z / Ctrl+Y) e salvamento automático do projeto.
- **Seções coloridas** (Intro, Verso, Refrão, Breakdown, Outro) sugeridas pela análise; ela arrasta seções inteiras como blocos de Lego.
- **Ouvir sempre:** espaço toca/pausa a partir do cursor; ao passar o mouse sobre um corte, toca os 2 compassos em volta.

### 13.2 Tela

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ◀ Voltar aos decks    ESTÚDIO · "Verão em Neon (Edit da Ana)"     ↶ ↷   Exportar ▸ │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Ferramentas: [✂ Cortar] [⧉ Duplicar] [🗑 Apagar] [↔ Estender] [◢ Fade]   Grade: 1 compasso ▾ │
├──────────────────────────────────────────────────────────────────────────────────┤
│ régua │1        │9        │17       │25       │33       │41                       │
│ seções│▓ INTRO ▓│▓ VERSO ▓│▓ REFRÃO▓│▒ BREAK ▒│▓ REFRÃO▓│▓ OUTRO ▓                │
│ MÚSICA│▁▂▅▇█▇▅▃▂▁▂▅▇█▇▅▃▂▁▂▅▇█▇▅▃▂▁▂▃▂▁▁▂▃▅▇█▇▅▃▂▁▂▅▇█▇▅▃▂▁▂▅▇█▇▅          │
│ SONS  │ [🎤 vinheta]                         [📯 buzina]           [🚨 sirene]    │
│ EFEITO│                      ════eco════                           ═filtro═══►   │
│ VOLUME│ ╱‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾╲ (fades) │
├──────────────────────────────────────────────────────────────────────────────────┤
│ PALETA: [Refrão 8c] [Batida 4c] [Vocal "ê"]  ← arraste trechos guardados           │
│ SONS:   🎤 Gravar vinheta · 📯 Buzina · 🚨 Sirene · 💥 Impacto · ⬆ Riser · + Importar │
│ EFEITOS: Eco · Reverb · Filtro · Freio · Reverse · Gate · Stutter · Volume         │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 13.3 Funções, em ordem de entrega

**v1 — editar a música (P1, item 10)**
1. Abrir qualquer música da biblioteca no Estúdio (botão "Editar" na linha ou no deck).
2. Selecionar um trecho arrastando na onda (gruda nos compassos).
3. **Cortar / apagar** o trecho; o resto "fecha o buraco" sem perder o ritmo.
4. **Duplicar** um trecho (ex.: repetir o refrão) e **mover** blocos.
5. **Estender intro/outro**: botão "Intro +8 compassos" repete a batida inicial (o uso mais comum em edits de DJ).
6. **Fades** de entrada e saída arrastando a ponta do bloco.
7. **Paleta**: guardar trechos para reutilizar.
8. **Exportar** em WAV (e MP3 quando possível) e **adicionar à biblioteca** com BPM, grid e cues herdados.
9. Modelos de um clique: **"Versão estendida"** (intro e outro de 16 compassos), **"Versão rádio"** (corta para ~3 min), **"Pro baile"** (tira o breakdown longo).

**v2 — inserir sons (P1, item 11)**
1. **Gravar vinheta** pelo microfone: contagem 3-2-1, corte automático do silêncio, normalização. Fica salva e vai para o sampler também.
2. Biblioteca de sons **sintetizados pelo próprio app** (sem direitos autorais): buzina, sirene, impacto, riser, "rewind", palmas. Mais tarde, um pack de sons livres.
3. **Importar** sons próprios (WAV/MP3).
4. Arrastar o som para a faixa SONS; ele gruda na batida; volume e fade por som.

**v3 — efeitos em trechos (P1, item 12)**
1. Pintar um efeito sobre um trecho na faixa EFEITO: eco (1/4, 1/2, 1 batida), reverb, filtro (passa-baixa/alta com rampa), **freio** (vinil parando), **reverse**, gate/stutter, volume.
2. Automação simples: o efeito pode "subir" ao longo do trecho (ex.: filtro abrindo até o drop).
3. Atalhos prontos: **"Saída com eco"** no último compasso e **"Subida pro drop"** (filtro + riser) nos 4 compassos antes do refrão.

**v4 — multipista e stems (P3, item 24)**
Várias músicas na mesma linha do tempo, stems por pista (vocal da música A + batida da música B), modelo **"Versão funk"** (acapella de pop sobre tamborzão das batidas prontas).

### 13.4 Como construir
- Projeto = JSON com a lista de blocos `{origem, início, fim, posição}`, sons e efeitos; salvo no IndexedDB.
- Reprodução no editor com o mesmo motor dos decks (agendando os blocos na linha do tempo do Web Audio).
- Exportação com `OfflineAudioContext` (renderiza mais rápido que tempo real) e codificação WAV em JavaScript; MP3 com codificador em WASM.
- Os cortes usam o grid já detectado; uma rampa de 5 ms em cada emenda evita estalos.
- Lição nova no Coach: **"Minha primeira edit"** (estender a intro em 8 compassos e exportar).

