# 🎧 Pista — software de DJ para aprender a mixar

Plano completo: [`PLANO.md`](PLANO.md).

## Como abrir (Windows)
1. Baixe o arquivo **`Pista.html`** desta pasta.
2. Dê **duplo clique** — ele abre no Edge ou no Chrome. Não precisa instalar nada nem ter internet.
3. Já vêm 4 músicas demo (pop, rock, tamborzão 130 e funk 150). Para usar as suas, arraste arquivos MP3/WAV/FLAC para a janela.

Atalhos: aperte <kbd>?</kbd> dentro do app.

## Para desenvolver
```bash
cd app
npm install
npm run dev       # abre em http://localhost:5173
npm test          # testes (detecção de BPM, grid, tom)
npm run release   # testa, gera e atualiza ../Pista.html
```

Estrutura:
- `app/src/audio/` — motor de áudio (decks, mixer, gravação), análise (BPM, "1" do compasso, ondas) e músicas demo sintetizadas
- `app/src/coach/` — dicas e avaliação das transições
- `app/src/components/` — decks, mixer, ondas, biblioteca, knobs
