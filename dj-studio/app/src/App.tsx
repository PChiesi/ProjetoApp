import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine, type DeckId, type Track } from './audio/engine';
import { beatInfo } from './audio/beat';
import { ensureBuffer, loadAllDemos, loadFile } from './audio/library';
import { del, getAll, put, recordToTrack, saveTrackState, trackToRecord, type SoundRecord, type StateRecord, type TrackRecord } from './storage/db';
import { encodeWav } from './studio/render';
import { saveFile } from './platform';
import { flx4Leds, flx4Map, keyOf, MidiDecoder, MidiHub, ACTIONS, type Binding } from './midi/midi';
import { Settings } from './midi/Settings';
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
const hub = new MidiHub();
function loadMidiMap(): Record<string, Binding> {
  try {
    const raw = storageGet('pista.midimap');
    if (raw) return JSON.parse(raw);
  } catch {
    /* mapa salvo inválido */
  }
  return flx4Map();
}
const decoder = new MidiDecoder(loadMidiMap());
const LEDS = flx4Leds();

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
  const [settings, setSettings] = useState(false);
  const [, setMidiVer] = useState(0);
  const [learning, setLearning] = useState<string | null>(null);
  const [lastMsg, setLastMsg] = useState('');
  const [libSel, setLibSel] = useState<string | null>(null);
  const syncFailRef = useRef<(id: DeckId) => void>(() => {});
  const midiRef = useRef<(action: string, value: number) => void>(() => {});
  const learnRef = useRef<string | null>(null);
  learnRef.current = learning;
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

  // ---------- controladora ----------
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const libSelRef = useRef(libSel);
  libSelRef.current = libSel;
  midiRef.current = (action: string, v: number) => {
    const [d, what] = action.includes('.') ? (action.split('.') as [DeckId, string]) : [null, action];
    const deck = d ? engine.decks[d] : null;
    const press = v > 0;
    const eq = (x: number) => (x < 0.5 ? -26 * (1 - x / 0.5) : 6 * ((x - 0.5) / 0.5));
    engine.resume();
    if (deck && d) {
      if (what === 'play') press && deck.toggle();
      else if (what === 'cue') press && deck.cue();
      else if (what === 'sync') {
        if (press) deck.synced ? engine.unsync(d) : engine.sync(d) || syncFailRef.current(d);
      } else if (what === 'pfl') press && engine.setPfl(d, !deck.pfl);
      else if (what === 'load') {
        if (!press) return;
        const t = tracksRef.current.find((x) => x.id === libSelRef.current);
        if (t) loadToDeck(d, t);
        else toast('Gire o BROWSE da controladora para escolher uma música na biblioteca.');
      } else if (what === 'tempo') {
        deck.synced = false;
        deck.setTempo(v * 2 - 1); // em cima = mais lento, como nos aparelhos Pioneer
        engine.followTempo(d);
      } else if (what === 'volume') engine.setCh('volume', d, v);
      else if (what === 'trim') engine.setCh('gain', d, (v * 2 - 1) * 12);
      else if (what === 'high' || what === 'mid' || what === 'low') engine.setCh(what, d, Math.abs(v - 0.5) < 0.02 ? 0 : eq(v));
      else if (what === 'filter') engine.setCh('filter', d, Math.abs(v - 0.5) < 0.03 ? 0 : v * 2 - 1);
      else if (what === 'jog') deck.jog(v);
      else if (what === 'loop4') press && deck.autoLoop(4);
      else if (what === 'loopExit') press && (deck.loop ? deck.exitLoop() : deck.autoLoop(4));
      else if (what === 'loopHalf') press && deck.resizeLoop(0.5);
      else if (what === 'loopDouble') press && deck.resizeLoop(2);
      else if (what.startsWith('hotcue')) press && deck.hotCue(Number(what.slice(6)));
      else if (what.startsWith('beatloop')) press && deck.autoLoop(Number(what.slice(8)));
      else if (what.startsWith('jump')) press && deck.beatJump(Number(what.slice(4)));
    } else if (what === 'xfader') engine.set('crossfader', Math.abs(v - 0.5) < 0.02 ? 0 : v * 2 - 1);
    else if (what === 'headMix') engine.setHeadMix(v);
    else if (what === 'browse') {
      const list = tracksRef.current;
      if (!list.length) return;
      const i = Math.max(0, list.findIndex((x) => x.id === libSelRef.current));
      const next = list[Math.max(0, Math.min(list.length - 1, i + Math.sign(v)))];
      setLibSel(next.id);
    } else if (what.startsWith('sampler')) {
      if (!press) return;
      const snd = bank.all()[Number(what.slice(7))];
      if (snd) engine.playSample(snd.buffer);
    }
  };

  useEffect(() => {
    hub.onMessage = (data) => {
      const raw = [...data];
      if (raw[0] === 0xf0) return; // resposta do keep-alive
      const learn = learnRef.current;
      if (learn) {
        const st = (raw[0] & 0xf0) === 0x80 ? 0x90 | (raw[0] & 0x0f) : raw[0];
        if ((st & 0xf0) === 0x90 && raw[2] === 0) return; // espera o "apertar"
        const def = ACTIONS.find((a) => a.id === learn)!;
        const isCC = (st & 0xf0) === 0xb0;
        const kind = def.kind === 'rel' ? 'rel' : def.kind === 'button' ? 'button' : isCC ? 'abs7' : 'button';
        decoder.map = { ...decoder.map, [keyOf(st, raw[1])]: { action: learn, kind } };
        storageSet('pista.midimap', JSON.stringify(decoder.map));
        setLearning(null);
        setMidiVer((x) => x + 1);
        toast(`Aprendido: ${def.name}`);
        return;
      }
      const ev = decoder.decode(raw);
      if (ev) midiRef.current(ev.action, ev.value);
      setLastMsg(raw.map((x) => x.toString(16).padStart(2, '0')).join(' ') + (ev ? ` → ${ACTIONS.find((a) => a.id === ev.action)?.name ?? ev.action}` : ' (sem função)'));
    };
    hub.onChange = () => setMidiVer((x) => x + 1);
    // Para testes e diagnóstico: simula mensagens da controladora (ex.: __pistaMidi([0x90, 0x0b, 0x7f])).
    (window as unknown as { __pistaMidi: (b: number[]) => void }).__pistaMidi = (b) => hub.onMessage(new Uint8Array(b));
    // Se ela já deu permissão antes, conecta sozinho.
    navigator.permissions
      ?.query({ name: 'midi' as PermissionName })
      .then((p) => p.state === 'granted' && hub.connect())
      .catch(() => {});
    // Luzes da controladora acompanham o app
    const leds = () => {
      if (!hub.status.connected.length) return;
      for (const d of ['A', 'B'] as DeckId[]) {
        const dk = engine.decks[d];
        const L = (k: string, on: boolean) => LEDS[`${d}.${k}`] && hub.led(LEDS[`${d}.${k}`][0], LEDS[`${d}.${k}`][1], on);
        L('play', dk.playing);
        L('cue', !!dk.track && !dk.playing);
        L('sync', dk.synced);
        L('pfl', dk.pfl);
        for (let i = 0; i < 8; i++) L(`hotcue${i}`, dk.track?.hotCues[i] != null);
      }
    };
    return engine.subscribe(leds) as unknown as () => void;
  }, [toast]);

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

  syncFailRef.current = syncFail;

  const toggleRec = useCallback(async () => {
    if (engine.recording) {
      const blob = await engine.stopRecording();
      if (!blob) return;
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const where = await saveFile(blob, `pista-set-${stamp}.webm`, { label: 'Gravação do set', ext: 'webm' }).catch(() => null);
      if (where) toast(`Set salvo${where === 'Downloads' ? ' na pasta Downloads' : ''}! Escute depois para ver o que melhorar. 🎧`);
      else toast('Gravação descartada.');
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
            <button className={`btn ghost ${hub.status.connected.length ? 'midi-on' : ''}`} onClick={() => setSettings(true)} title="Som, fone e controladora">
              {hub.status.connected.length ? '🎛 ' : ''}⚙
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

        <Library engine={engine} tracks={tracks} pending={pending} onLoad={loadToDeck} onFiles={(f) => addFiles(f)} onEdit={openStudio} onRemove={removeTrack} selectedId={libSel ?? undefined} onSelect={setLibSel} editing={view === 'studio' ? studioTrack?.id : undefined} />

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

        {settings && (
          <Settings
            engine={engine}
            midi={{ supported: hub.status.supported, connected: hub.status.connected, isFlx4: hub.isFlx4, map: decoder.map, learning, lastMsg }}
            onConnect={async () => {
              const ok = await hub.connect();
              if (!ok) toast('Não consegui acessar a controladora. Verifique o cabo USB e permita o acesso MIDI no navegador.');
              setMidiVer((x) => x + 1);
            }}
            onLearn={setLearning}
            onResetMap={() => {
              decoder.map = flx4Map();
              storageSet('pista.midimap', JSON.stringify(decoder.map));
              setMidiVer((x) => x + 1);
            }}
            onClearBinding={(k) => {
              const m = { ...decoder.map };
              delete m[k];
              decoder.map = m;
              storageSet('pista.midimap', JSON.stringify(m));
              setMidiVer((x) => x + 1);
            }}
            onClose={() => {
              setSettings(false);
              setLearning(null);
            }}
          />
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
