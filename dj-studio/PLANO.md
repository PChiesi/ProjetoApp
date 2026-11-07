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

| Fase | Entrega | Critério de pronto |
|---|---|---|
| **0. Fundação** (1–2 sem.) | Repositório, Vite+React+TS, AudioEngine com 1 deck tocando arquivo local, CI com testes. | Toca, pausa, mostra waveform estática. |
| **1. MVP "Primeira mixagem"** (4–6 sem.) | 2 decks, mixer completo, crossfader, BPM/grid, sync, key lock, biblioteca, gravação, pack demo. | Ela consegue gravar uma mixagem de 2 músicas sem ajuda. |
| **2. Coach v1** (3–4 sem.) | Lições 1–7, medidor de alinhamento, contador de frase, modos Iniciante/Intermediário. | Completar as lições 1–7 sozinha; feedback dela registrado. |
| **3. Controle criativo** (4 sem.) | Hot cues, loops, FX, sampler, lições 8–10, atalhos, MIDI learn. | Usar com uma controladora real. |
| **4. Seleção e set** (3 sem.) | Camelot, sugestões, playlists, frases, relatório pós-set, lições 11–12. | Gravar um set de 30 min. |
| **5. Remix** (6+ sem.) | Stems com ONNX/WebGPU, Remix Studio, captura de loops. | Exportar um mashup. |
| **6. Desktop** (2 sem.) | Empacotar com Tauri, instalador Windows/macOS, atalho na área de trabalho. | Instalar com duplo clique. |

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

### Próximos
1. Testar com ela: abrir o `Pista.html`, deixar ela tocar sem explicar nada, anotar onde travou.
2. Key lock (mudar o BPM sem mudar o tom) e detecção de tom para os arquivos dela.
3. Trilha de lições guiadas (seção 5.1 + 9.2) com progresso salvo.
4. Mapeamento da DDJ-FLX4 (Web MIDI) e saída de fone pela placa da controladora.
5. Hot cues, loops, efeitos e sampler com vinheta.
