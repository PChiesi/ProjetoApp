import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine, type DeckId, type Track } from './audio/engine';
import { beatInfo } from './audio/beat';
import { ensureBuffer, loadAllDemos, loadFile } from './audio/library';
import { del, getAll, put, recordToTrack, saveTrackState, trackToRecord, type SoundRecord, type StateRecord, type TrackRecord } from './storage/db';
import { encodeWav } from './studio/render';
import { coachTip, TransitionJudge, type Snapshot, type Tip, type TransitionResult } from './coach/coach';
import { DeckPanel } from './components/DeckPanel';
import { Library } from './components/Library';
import { AlignMeter, Mixer } from './components/Mixer';
import { OverviewWaveform, ScrollingWaveform } from './components/Waveform';
import { LEVEL_NAMES, LevelContext, type SkillLevel } from './components/Level';
import { fmtTime, storageGet, storageSet, useEngine, useFrame } from './hooks';
import { Studio } from './studio/Studio';
import { SoundBank } from './studio/sounds';

const engine = new AudioEngine();
const bank = new SoundBank(engine.ctx);

interface Toast {
  id: number;
  text: string;
  stars?: number;
}

export default function App() {
  useEngine(engine);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [level, setLevel] = useState<SkillLevel>(() => (Number(storageGet('pista.level')) || 1) as SkillLevel);
  const [name, setName] = useState(() => storageGet('pista.name') ?? '');
  const [welcome, setWelcome] = useState(() => !storageGet('pista.name'));
  const [coachOn, setCoachOn] = useState(() => storageGet('pista.coach') !== 'off');
  const [tip, setTip] = useState<Tip | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [help, setHelp] = useState(false);
  const [zoom, setZoom] = useState(110);
  const [dragFiles, setDragFiles] = useState(false);
  const [view, setView] = useState<'decks' | 'studio'>('decks');
  const [studioTrack, setStudioTrack] = useState<Track | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const recRef = useRef<HTMLSpanElement>(null);

  const toast = useCallback((text: string, stars?: number) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, stars }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), stars ? 9000 : 5000);
  }, []);

  // Músicas demo: som em segundos, sem procurar nada.
  useEffect(() => {
    let alive = true;
    (async () => {
      const demos = await loadAllDemos(engine.ctx);
      if (!alive) return;
      // Hot cues e ajustes de grid salvos das demos
      const states = await getAll<StateRecord>('state');
      for (const st of states) {
        const d = demos.find((x) => x.id === st.id);
        if (d) Object.assign(d, { hotCues: st.hotCues, bpm: st.bpm, firstBeat: st.firstBeat });
      }
      // Músicas dela (o áudio só é decodificado quando for usado)
      const saved = (await getAll<TrackRecord>('tracks')).sort((a, b) => a.addedAt - b.addedAt).map(recordToTrack);
      if (!alive) return;
      setTracks((t) => [...demos, ...saved, ...t]);
      engine.decks.A.load(demos[0]);
      engine.decks.B.load(demos[1]);
      if (saved.length) toast(`Biblioteca carregada: ${saved.length} música${saved.length > 1 ? 's' : ''} sua${saved.length > 1 ? 's' : ''}.`);
      // Vinhetas e sons dela
      for (const r of await getAll<SoundRecord>('sounds')) {
        try {
          const buffer = await engine.ctx.decodeAudioData(await r.wav.arrayBuffer());
          bank.add({ id: r.id, name: r.name, icon: r.icon, buffer, user: true });
        } catch {
          /* som corrompido: ignora */
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Navegadores só liberam o som depois do primeiro clique.
  useEffect(() => {
    const unlock = () => engine.resume();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const addFiles = useCallback(
    async (files: FileList | File[], toDeck?: DeckId) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(f.name));
      if (!list.length) {
        toast('Esse arquivo não é de áudio. Use MP3, WAV, FLAC, OGG ou M4A.');
        return;
      }
      for (const f of list) {
        setPending((p) => [...p, f.name]);
        try {
          const t = await loadFile(engine.ctx, f);
          setTracks((ts) => [...ts, t]);
          put('tracks', trackToRecord(t, f));
          if (toDeck && f === list[0]) engine.decks[toDeck].load(t);
        } catch {
          toast(`Não consegui abrir "${f.name}". O arquivo pode estar corrompido ou em formato não suportado.`);
        } finally {
          setPending((p) => p.filter((n) => n !== f.name));
        }
      }
    },
    [toast],
  );

  const loadToDeck = useCallback(
    (id: DeckId, t: Track) => {
      const d = engine.decks[id];
      if (d.playing && engine.audibility(id) > 0.25) {
        toast(`O Deck ${id} está tocando no som principal! Abaixe o volume dele antes de trocar a música.`);
        return;
      }
      if (t.buffer) d.load(t);
      else
        ensureBuffer(engine.ctx, t)
          .then(() => d.load(t))
          .catch(() => toast(`Não consegui abrir "${t.title}".`));
    },
    [toast],
  );

  const openStudio = useCallback(
    (t: Track | null) => {
      if (!t) return;
      ensureBuffer(engine.ctx, t)
        .then(() => {
          setStudioTrack(t);
          setView('studio');
        })
        .catch(() => toast(`Não consegui abrir "${t.title}".`));
    },
    [toast],
  );

  const removeTrack = useCallback(
    (t: Track) => {
      if (engine.decks.A.track === t || engine.decks.B.track === t) {
        toast('Essa música está num deck. Troque a música do deck antes de remover.');
        return;
      }
      if (!window.confirm(`Remover "${t.title}" da biblioteca?`)) return;
      setTracks((ts) => ts.filter((x) => x !== t));
      if (studioTrack === t) {
        setStudioTrack(null);
        setView('decks');
      }
      del('tracks', t.id);
    },
    [toast, studioTrack],
  );

  // Salva hot cues e ajustes de grid (1 s depois da última mudança).
  useEffect(() => {
    let timer = 0;
    const last = new Map<string, string>();
    const unsub = engine.subscribe(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        for (const d of [engine.decks.A, engine.decks.B]) {
          const t = d.track;
          if (!t) continue;
          const sig = JSON.stringify([t.hotCues, t.bpm, t.firstBeat]);
          if (last.get(t.id) !== sig) {
            last.set(t.id, sig);
            saveTrackState(t);
          }
        }
      }, 1000);
    });
    return () => {
      unsub();
    };
  }, []);

  // Coach: dicas e avaliação das transições.
  const judge = useRef(new TransitionJudge());
  const coachClock = useRef(0);
  const shownTip = useRef<{ tip: Tip | null; since: number }>({ tip: null, since: 0 });
  useFrame((dt) => {
    coachClock.current += dt;
    if (recRef.current) recRef.current.textContent = engine.recordingSince ? fmtTime((performance.now() - engine.recordingSince) / 1000) : '';
    if (coachClock.current < 0.25) return;
    const step = coachClock.current;
    coachClock.current = 0;
    const p = engine.peaks();
    const snap = (id: DeckId) => {
      const d = engine.decks[id];
      const pos = d.position();
      return {
        loaded: !!d.track,
        playing: d.playing,
        audible: engine.audibility(id),
        bpm: d.bpm,
        low: engine.mix.low[id],
        remaining: d.track ? d.track.duration - pos : 0,
        beatsToNextPhrase: d.grid ? beatInfo(d.grid, pos).beatsToNextPhrase : 0,
        synced: d.synced,
      };
    };
    const s: Snapshot = { A: snap('A'), B: snap('B'), phaseMs: engine.phaseOffsetMs(), clip: p.clip, level };
    const result: TransitionResult | null = judge.current.update(s, step);
    if (result && coachOn) toast(result.message, result.stars);
    const next = coachOn ? coachTip(s) : null;
    // Evita "piscar": troca de dica no máximo a cada 2,5 s (exceto alertas).
    const now = performance.now();
    const cur = shownTip.current;
    if (next?.id !== cur.tip?.id && (now - cur.since > 2500 || next?.tone === 'warn' || !cur.tip)) {
      shownTip.current = { tip: next, since: now };
      setTip(next);
    } else if (next && cur.tip && next.id === cur.tip.id && next.text !== cur.tip.text) {
      shownTip.current = { tip: next, since: cur.since };
      setTip(next);
    }
  });

  // Destaca o controle que a dica menciona.
  useEffect(() => {
    document.querySelectorAll('.coach-glow').forEach((el) => el.classList.remove('coach-glow'));
    if (tip?.target) document.querySelectorAll(`[data-coach="${tip.target}"]`).forEach((el) => el.classList.add('coach-glow'));
  }, [tip, level]);

  const syncFail = useCallback(
    (id: DeckId) => {
      const a = engine.decks[id].track?.bpm ?? 0;
      const b = engine.other(id).bpm;
      toast(
        `${a.toFixed(0)} e ${b.toFixed(0)} BPM estão longe demais para o SYNC (mais de 16%). No funk isso é comum (130 → 150): faça um corte seco no "1" com o crossfader, ou saia com eco.`,
      );
    },
    [toast],
  );

  const toggleRec = useCallback(async () => {
    if (engine.recording) {
      const blob = await engine.stopRecording();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      a.href = url;
      a.download = `pista-set-${stamp}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast('Set salvo na pasta Downloads! Escute depois para ver o que melhorar. 🎧');
    } else {
      await engine.resume();
      engine.startRecording();
      toast('Gravando o seu set…');
    }
  }, [toast]);

  // Atalhos de teclado
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => e.target instanceof HTMLInputElement && e.target.type !== 'range';
    const down = (e: KeyboardEvent) => {
      if (viewRef.current === 'studio') return; // o Estúdio tem os próprios atalhos
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const A = engine.decks.A;
      const B = engine.decks.B;
      const xf = engine.mix.crossfader;
      const map: Record<string, () => void> = {
        q: () => A.cue(),
        w: () => A.toggle(),
        e: () => (A.synced ? engine.unsync('A') : engine.sync('A') || syncFail('A')),
        p: () => B.cue(),
        o: () => B.toggle(),
        i: () => (B.synced ? engine.unsync('B') : engine.sync('B') || syncFail('B')),
        '1': () => A.nudge(-1),
        '2': () => A.nudge(1),
        '9': () => B.nudge(-1),
        '0': () => B.nudge(1),
        z: () => engine.set('crossfader', Math.max(-1, xf - 0.1)),
        x: () => engine.set('crossfader', Math.min(1, xf + 0.1)),
        c: () => engine.set('crossfader', 0),
        r: () => toggleRec(),
        '?': () => setHelp((h) => !h),
        escape: () => setHelp(false),
      };
      const fn = map[k];
      if (fn && !e.repeat) {
        e.preventDefault();
        engine.resume();
        fn();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === '1' || k === '2') engine.decks.A.nudge(0);
      if (k === '9' || k === '0') engine.decks.B.nudge(0);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [toggleRec, syncFail]);

  const chooseLevel = (l: SkillLevel) => {
    setLevel(l);
    storageSet('pista.level', String(l));
  };

  return (
    <LevelContext.Provider value={level}>
      <div
        className={`app level-${level}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragFiles(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.target === e.currentTarget) setDragFiles(false);
        }}
        onDrop={(e) => {
          setDragFiles(false);
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }
        }}
      >
        <header className="topbar">
          <div className="brand">
            <span className="logo" aria-hidden>
              ◉
            </span>
            Pista
            {name && <span className="hello">· bora tocar, {name}!</span>}
          </div>
          <div className="view-tabs" role="tablist" aria-label="Área">
            <button role="tab" aria-selected={view === 'decks'} className={`tab ${view === 'decks' ? 'on' : ''}`} onClick={() => setView('decks')}>
              🎧 Tocar
            </button>
            <button
              role="tab"
              aria-selected={view === 'studio'}
              className={`tab ${view === 'studio' ? 'on' : ''}`}
              onClick={() => {
                if (studioTrack) setView('studio');
                else openStudio(engine.decks.A.track ?? tracks[0] ?? null);
              }}
            >
              ✂ Estúdio
            </button>
          </div>
          <div className="top-actions">
            <div className="level-switch" role="radiogroup" aria-label="Nível">
              {([1, 2, 3] as SkillLevel[]).map((l) => (
                <button key={l} role="radio" aria-checked={level === l} className={`chip ${level === l ? 'on' : ''}`} onClick={() => chooseLevel(l)}>
                  {LEVEL_NAMES[l]}
                </button>
              ))}
            </div>
            <button className={`btn rec ${engine.recording ? 'on' : ''}`} onClick={toggleRec} title="Gravar o set (R)">
              ● REC <span ref={recRef} />
            </button>
            <button className="btn ghost" onClick={() => setHelp(true)} title="Atalhos de teclado (?)">
              ⌨ ?
            </button>
          </div>
        </header>

        {view === 'studio' && studioTrack ? (
          <Studio
            engine={engine}
            track={studioTrack}
            onExit={() => setView('decks')}
            onSaved={(t) => {
              setTracks((ts) => [...ts, t]);
              put('tracks', trackToRecord(t, encodeWav(t.buffer!)));
            }}
            toast={toast}
            bank={bank}
            onUserSound={(snd) => {
              bank.add(snd);
              put('sounds', { id: snd.id, name: snd.name, icon: snd.icon, wav: encodeWav(snd.buffer) } satisfies SoundRecord);
            }}
            onRemoveUserSound={(id) => {
              bank.remove(id);
              del('sounds', id);
            }}
          />
        ) : (
        <>
        <div className="waves">
          {(['A', 'B'] as DeckId[]).map((id) => (
            <div key={id} className={`wave-row wave-${id.toLowerCase()}`} onWheel={(e) => setZoom((z) => Math.max(40, Math.min(400, z * (e.deltaY > 0 ? 0.9 : 1.1))))}>
              <ScrollingWaveform deck={engine.decks[id]} color={id === 'A' ? '#22d3ee' : '#f472b6'} zoom={zoom} />
            </div>
          ))}
          <AlignMeter engine={engine} />
        </div>

        <main className="console">
          <div className="deck-col">
            <OverviewWaveform deck={engine.decks.A} color="#22d3ee" />
            <DeckPanel engine={engine} id="A" onDropTrack={(id, tid) => loadById(id, tid)} onDropFiles={(id, f) => addFiles(f, id)} onSyncFail={syncFail} />
          </div>
          <Mixer engine={engine} />
          <div className="deck-col">
            <OverviewWaveform deck={engine.decks.B} color="#f472b6" />
            <DeckPanel engine={engine} id="B" onDropTrack={(id, tid) => loadById(id, tid)} onDropFiles={(id, f) => addFiles(f, id)} onSyncFail={syncFail} />
          </div>
        </main>

        <div className={`coach ${tip ? `tone-${tip.tone}` : ''}`} role="status" aria-live="polite">
          <span className="coach-icon" aria-hidden>
            {tip?.tone === 'warn' ? '⚠️' : tip?.tone === 'good' ? '✨' : '💡'}
          </span>
          <span className="coach-text">{coachOn ? tip?.text ?? 'Mandou bem! Continue assim.' : 'Dicas do Coach desligadas.'}</span>
          <button
            className="btn ghost tiny"
            onClick={() => {
              setCoachOn((c) => {
                storageSet('pista.coach', c ? 'off' : 'on');
                return !c;
              });
            }}
          >
            {coachOn ? 'Desligar dicas' : 'Ligar dicas'}
          </button>
        </div>

        </>
        )}

        <Library engine={engine} tracks={tracks} pending={pending} onLoad={loadToDeck} onFiles={(f) => addFiles(f)} onEdit={openStudio} onRemove={removeTrack} editing={view === 'studio' ? studioTrack?.id : undefined} />

        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.stars ? 'graded' : ''}`}>
              {t.stars && (
                <div className="stars" aria-label={`${t.stars} de 3 estrelas`}>
                  {'★'.repeat(t.stars)}
                  <span>{'★'.repeat(3 - t.stars)}</span>
                </div>
              )}
              {t.text}
            </div>
          ))}
        </div>

        {dragFiles && <div className="drop-overlay">Solte para adicionar à biblioteca 🎵</div>}

        {help && (
          <div className="modal-bg" onClick={() => setHelp(false)}>
            <div className="modal" role="dialog" aria-label="Atalhos" onClick={(e) => e.stopPropagation()}>
              <h2>Atalhos de teclado</h2>
              <div className="keys">
                <div>
                  <h3 style={{ color: 'var(--deck-a)' }}>Deck A</h3>
                  <p><kbd>Q</kbd> CUE</p>
                  <p><kbd>W</kbd> Tocar / pausar</p>
                  <p><kbd>E</kbd> SYNC</p>
                  <p><kbd>1</kbd> <kbd>2</kbd> Frear / acelerar (segure)</p>
                </div>
                <div>
                  <h3 style={{ color: 'var(--deck-b)' }}>Deck B</h3>
                  <p><kbd>P</kbd> CUE</p>
                  <p><kbd>O</kbd> Tocar / pausar</p>
                  <p><kbd>I</kbd> SYNC</p>
                  <p><kbd>9</kbd> <kbd>0</kbd> Frear / acelerar (segure)</p>
                </div>
                <div>
                  <h3>Mixer</h3>
                  <p><kbd>Z</kbd> <kbd>X</kbd> Crossfader ← →</p>
                  <p><kbd>C</kbd> Crossfader no meio</p>
                  <p><kbd>R</kbd> Gravar</p>
                  <p>Duplo clique num botão giratório volta ao centro</p>
                </div>
              </div>
              <button className="btn" onClick={() => setHelp(false)}>
                Fechar
              </button>
            </div>
          </div>
        )}

        {welcome && (
          <Welcome
            onDone={(n, l) => {
              setName(n);
              storageSet('pista.name', n || ' ');
              chooseLevel(l);
              setWelcome(false);
              engine.resume();
            }}
          />
        )}
      </div>
    </LevelContext.Provider>
  );

  function loadById(id: DeckId, trackId: string) {
    const t = tracks.find((x) => x.id === trackId);
    if (t) loadToDeck(id, t);
  }
}

function Welcome({ onDone }: { onDone: (name: string, level: SkillLevel) => void }) {
  const [n, setN] = useState('');
  const [l, setL] = useState<SkillLevel>(1);
  return (
    <div className="modal-bg">
      <form
        className="modal welcome"
        role="dialog"
        aria-label="Boas-vindas"
        onSubmit={(e) => {
          e.preventDefault();
          onDone(n.trim(), l);
        }}
      >
        <div className="welcome-logo" aria-hidden>
          ◉
        </div>
        <h2>Bem-vinda à Pista!</h2>
        <p>Aqui você aprende a mixar tocando. Já deixamos duas músicas prontas nos decks.</p>
        <label className="field">
          <span>Como você quer ser chamada?</span>
          <input autoFocus value={n} onChange={(e) => setN(e.target.value)} placeholder="Seu nome ou nome de DJ" maxLength={30} />
        </label>
        <fieldset className="field">
          <legend>Você já mexeu com DJ?</legend>
          {(
            [
              [1, 'Nunca', 'Mostro só o essencial e te guio passo a passo'],
              [2, 'Um pouco', 'Libera EQ completo e ajuste fino das batidas'],
              [3, 'Já toco', 'Todos os controles'],
            ] as [SkillLevel, string, string][]
          ).map(([v, label, desc]) => (
            <label key={v} className={`option ${l === v ? 'on' : ''}`}>
              <input type="radio" name="lvl" checked={l === v} onChange={() => setL(v)} />
              <strong>{label}</strong>
              <small>{desc}</small>
            </label>
          ))}
        </fieldset>
        <button className="btn primary" type="submit">
          Começar a tocar ▶
        </button>
      </form>
    </div>
  );
}
