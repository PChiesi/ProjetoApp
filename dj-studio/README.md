# 🎧 Pista — software de DJ para aprender a mixar

Plano completo: [`PLANO.md`](PLANO.md).

## Como instalar (Windows) — recomendado
1. No GitHub, abra **Actions → "Pista — executável Windows"** → execução mais recente.
2. Baixe o artefato **Pista-instalador-Windows**, descompacte e rode o `Pista_…_x64-setup.exe`.
   (Ou baixe **Pista-exe-Windows** para usar o `Pista.exe` sem instalar.)
3. O Pista aparece no menu Iniciar e na área de trabalho, abre em janela própria e salva tudo sozinho.

> O Windows pode mostrar "O Windows protegeu o seu computador" porque o app ainda não tem assinatura digital: clique em **Mais informações → Executar assim mesmo**.

## Como abrir sem instalar (navegador)
1. Baixe o arquivo **`Pista.html`** desta pasta.
2. Dê **duplo clique** — ele abre no Edge ou no Chrome. Não precisa instalar nada nem ter internet.
3. Já vêm 4 músicas demo (pop, rock, tamborzão 130 e funk 150). Para usar as suas, arraste arquivos MP3/WAV/FLAC para a janela.

Atalhos: aperte <kbd>?</kbd> dentro do app.

**Controladora (DDJ-FLX4):** ligue no USB, clique em ⚙ → "Conectar controladora" e permita o acesso. Para ouvir a pré-escuta no fone da controladora, escolha a placa dela em ⚙ e o modo "Controladora (4 canais)". Algum botão fazendo a coisa errada? ⚙ → "Ver / trocar controles" → "Aprender".

**Tudo fica salvo** no próprio navegador (músicas, edições, vinhetas, hot cues). Use sempre o mesmo navegador e o mesmo arquivo `Pista.html`.

**Estúdio:** clique em ✎ ao lado de uma música (ou na aba "✂ Estúdio") para cortar, repetir e estender trechos, fazer fades e salvar a sua versão — ela volta para a biblioteca pronta para tocar.

## Para desenvolver
```bash
cd app
npm install
npm run dev       # abre em http://localhost:5173
npm test          # testes (detecção de BPM, grid, tom)
npm run release   # testa, gera e atualiza ../Pista.html
npm run app:dev   # abre como app de desktop (precisa do Rust instalado)
npm run app:build # gera o instalador do Windows (em src-tauri/target/release/bundle)
```

O app de desktop usa **Tauri 2** (pasta `app/src-tauri`): janela nativa com o WebView2 do Windows, instalador NSIS/MSI de poucos MB, diálogo "Salvar como" nativo para sets e WAVs.

Estrutura:
- `app/src/audio/` — motor de áudio (decks, mixer, gravação), análise (BPM, "1" do compasso, ondas) e músicas demo sintetizadas
- `app/src/coach/` — dicas e avaliação das transições
- `app/src/studio/` — Estúdio: modelo de edição por blocos (`edit.ts`), reprodução/exportação (`render.ts`) e a tela
- `app/src/components/` — decks, mixer, ondas, biblioteca, knobs
