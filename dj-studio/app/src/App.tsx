import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine, type DeckId, type Track } from './audio/engine';
import { beatInfo } from './audio/beat';
import { ensureBuffer, loadAllDemos, loadFile } from './audio/library';
import { del, getAll, put, recordToTrack, saveTrackState, trackToRecord, type SoundRecord, type StateRecord, type TrackRecord } from './storage/db';
import { encodeWav } from './studio/render';
import { saveFile } from './platform';
import { canWatchFolders, fileKey, hasPermission, listAudio, loadWatched, pickFolder, saveWatched, type WatchedFolder } from './storage/folders';
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
import { Sampler, SAMPLER_KEYS } from './components/Sampler';
import { LessonCard, LessonsModal, type Progress } from './components/Lessons';
import { VideosModal } from './components/VideosModal';
import { LESSONS, type Lesson } from './coach/lessons';
import { TransitionRunner, type TransitionId } from './coach/transitions';
import { Automix } from './coach/automix';
import { AutoBar } from './components/AutoBar';
import { SetRecorder, type SetReport } from './coach/report';
import { SetReportModal, SetsHistory } from './components/SetReportModal';
import { hasStems, loadStems, modelCached, separateTrack } from './audio/stems';
import type { StemJob } from './components/StemsPanel';
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
  const samplerRef = useRef<(i: number) => void>(() => {});
  // ---- stems ----
  const [stemJob, setStemJob] = useState<StemJob | null>(null);
  const [stemReady, setStemReady] = useState<Record<string, boolean>>({});
  // ---- relatório pós-set ----
  const setRec = useRef(new SetRecorder());
  const [report, setReport] = useState<SetReport | null>(null);
  const [setsOpen, setSetsOpen] = useState(false);
  // ---- transições prontas e automix ----
  const [narration, setNarration] = useState<string | null>(null);
  const [runningTr, setRunningTr] = useState<string | null>(null);
  const [automixOn, setAutomixOn] = useState(false);
  const runnerRef = useRef<TransitionRunner | null>(null);
  const automixRef = useRef<Automix | null>(null);
  // ---- lições ----
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const [videosOpen, setVideosOpen] = useState(false);
  const [lesson, setLesson] = useState<{ l: Lesson; step: number } | null>(null);
  const [passed, setPassed] = useState(false);
  const lessonMem = useRef<Record<string, number | boolean | string>>({});
  const [progress, setProgress] = useState<Progress>(() => {
    try {
      return JSON.parse(storageGet('pista.lessons') ?? '{}');
    } catch {
      return {};
    }
  });
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

  /** Já está na biblioteca (ou ela removeu de propósito)? */
  const knownKey = (key: string) => {
    if (tracksRef.current.some((t) => t.sourceKey === key)) return true;
    try {
      return (JSON.parse(storageGet('pista.ignored') ?? '[]') as string[]).includes(key);
    } catch {
      return false;
    }
  };

  /** Importa arquivos (com a "chave" de origem para não duplicar). Retorna quantos entraram. */
  const importItems = async (items: { key: string; name: string; getFile: () => Promise<File> }[], toDeck?: DeckId, quiet = false) => {
    let added = 0;
    for (const it of items) {
      if (knownKey(it.key)) continue;
      setPending((p) => [...p, it.name]);
      try {
        const f = await it.getFile();
        const t = await loadFile(engine.ctx, f);
        t.sourceKey = it.key;
        setTracks((ts) => [...ts, t]);
        tracksRef.current = [...tracksRef.current, t];
        put('tracks', trackToRecord(t, f));
        if (toDeck && added === 0) engine.decks[toDeck].load(t);
        added++;
      } catch {
        if (!quiet) toast(`Não consegui abrir "${it.name}". O arquivo pode estar corrompido ou em formato não suportado.`);
      } finally {
        setPending((p) => p.filter((n) => n !== it.name));
      }
    }
    return added;
  };

  const addFiles = useCallback(
    async (files: FileList | File[], toDeck?: DeckId) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(f.name));
      if (!list.length) {
        toast('Nenhum arquivo de áudio aqui. Use MP3, WAV, FLAC, OGG ou M4A.');
        return;
      }
      const items = list.map((f) => ({ key: fileKey(f), name: f.name, getFile: async () => f }));
      const dup = items.filter((i) => knownKey(i.key)).length;
      const added = await importItems(items, toDeck);
      if (list.length > 1 || dup) toast(`${added} música${added === 1 ? '' : 's'} adicionada${added === 1 ? '' : 's'}${dup ? ` · ${dup} já estava${dup === 1 ? '' : 'm'} na biblioteca` : ''}.`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast],
  );

  // ---- pasta vigiada ----
  const [watched, setWatched] = useState<WatchedFolder | null>(null);
  const [watchPerm, setWatchPerm] = useState(true);
  const scanning = useRef(false);
  const scan = useCallback(
    async (f: WatchedFolder | null, announce = false) => {
      if (!f || scanning.current) return;
      if (!(await hasPermission(f))) return setWatchPerm(false);
      setWatchPerm(true);
      scanning.current = true;
      try {
        const files = await listAudio(f);
        const fresh = files.filter((x) => !knownKey(x.key));
        if (fresh.length) {
          const n = await importItems(fresh, undefined, true);
          if (n) toast(`📂 ${n} música${n === 1 ? ' nova' : 's novas'} da pasta "${f.name}" já ${n === 1 ? 'está' : 'estão'} na biblioteca.`);
        } else if (announce) toast(`Vigiando a pasta "${f.name}": ${files.length} música${files.length === 1 ? '' : 's'}, todas já na biblioteca.`);
      } catch {
        if (announce) toast('Não consegui ler essa pasta.');
      } finally {
        scanning.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast],
  );
  useEffect(() => {
    if (!canWatchFolders()) return;
    let w: WatchedFolder | null = null;
    loadWatched().then((f) => {
      w = f;
      setWatched(f);
      // espera a biblioteca salva carregar antes da primeira varredura
      setTimeout(() => scan(f), 4000);
    });
    const tick = () => scan(w);
    const iv = window.setInterval(tick, 15000);
    window.addEventListener('focus', tick);
    const sync = (e: Event) => (w = (e as CustomEvent<WatchedFolder | null>).detail);
    window.addEventListener('pista-folder', sync);
    return () => {
      clearInterval(iv);
      window.removeEventListener('focus', tick);
      window.removeEventListener('pista-folder', sync);
    };
  }, [scan]);
  const setFolder = (f: WatchedFolder | null) => {
    setWatched(f);
    saveWatched(f);
    window.dispatchEvent(new CustomEvent('pista-folder', { detail: f }));
  };

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

  const loadAsync = useCallback(async (id: DeckId, t: Track) => {
    const d = engine.decks[id];
    if (d.playing && engine.audibility(id) > 0.25) return false;
    try {
      await ensureBuffer(engine.ctx, t);
      d.load(t);
      return true;
    } catch {
      return false;
    }
  }, []);

  const runTransition = useCallback((out: DeckId, inc: DeckId, id: TransitionId, onEnd?: (ok: boolean) => void): string | null => {
    runnerRef.current?.stop(false);
    const r = new TransitionRunner(engine, out, inc, id, (text) => setNarration(text), (ok) => {
      if (runnerRef.current === r) runnerRef.current = null;
      setRunningTr(null);
      onEnd?.(ok);
    });
    const err = r.start();
    if (err) return err;
    runnerRef.current = r;
    setRunningTr(r.def.name);
    return null;
  }, []);

  if (!automixRef.current)
    automixRef.current = new Automix({
      engine,
      tracks: () => tracksRef.current,
      load: (d, t) => loadAsync(d, t),
      say: (text) => setNarration(text),
      run: (o, i, id, onEnd) => runTransition(o, i, id, onEnd),
    });

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
      if (t.sourceKey) {
        // não reimportar da pasta vigiada uma música que ela removeu
        try {
          const ign = JSON.parse(storageGet('pista.ignored') ?? '[]') as string[];
          storageSet('pista.ignored', JSON.stringify([...ign, t.sourceKey].slice(-2000)));
        } catch {
          /* ignora */
        }
      }
    },
    [toast, studioTrack],
  );

  // Ao carregar uma música num deck, liga os stems se ela já foi separada.
  const deckTrackIds = `${engine.decks.A.track?.id}|${engine.decks.B.track?.id}`;
  useEffect(() => {
    for (const d of ['A', 'B'] as DeckId[]) {
      const dk = engine.decks[d];
      const t = dk.track;
      if (!t || dk.stems) continue;
      hasStems(t.id).then(async (has) => {
        setStemReady((r) => ({ ...r, [t.id]: has }));
        if (!has) return;
        const set = await loadStems(engine.ctx, t.id).catch(() => null);
        if (set && dk.track === t && !dk.stems) dk.setStems(set);
      });
    }
  }, [deckTrackIds]);

  const separate = useCallback(
    async (d: DeckId) => {
      const t = engine.decks[d].track;
      if (!t || stemJob) return;
      if (!(await modelCached()) && !window.confirm('Na primeira vez o Pista baixa o modelo de IA que separa as músicas (cerca de 172 MB, precisa de internet). Depois funciona sem baixar de novo. Continuar?')) return;
      setStemJob({ trackId: t.id, status: { phase: 'preparando' } });
      try {
        const set = await separateTrack(engine.ctx, t, (status) => setStemJob({ trackId: t.id, status }));
        setStemReady((r) => ({ ...r, [t.id]: true }));
        for (const dk of [engine.decks.A, engine.decks.B]) if (dk.track === t) dk.setStems(set);
        toast(`Stems prontos para "${t.title}"! Experimente desligar o 🎤 Vocal (instrumental) ou deixar só ele (acapella).`);
      } catch (err) {
        toast(`Não consegui separar: ${err instanceof Error ? err.message : 'erro desconhecido'}. Verifique a internet na primeira vez (download do modelo).`);
      } finally {
        setStemJob(null);
      }
    },
    [stemJob, toast],
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
      const n = Number(what.slice(7));
      if (n < 8) samplerRef.current(n);
      else {
        const snd = bank.all()[n - 8];
        if (snd) engine.playSample(snd.buffer);
      }
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
    (window as unknown as { __pista: unknown }).__pista = { engine };
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
    if (lesson && !passed) {
      const st = lesson.l.steps[lesson.step];
      lessonMem.current.view = viewRef.current;
      if (st && st.check({ engine, bank, tracks: tracksRef.current, mem: lessonMem.current, dt: step })) advanceLesson();
    }
    const result: TransitionResult | null = judge.current.update(s, step);
    const auto = !!runnerRef.current || !!automixRef.current?.on;
    if (result && coachOn && !auto) toast(result.message, result.stars);
    // Relatório do set (durante a gravação)
    const nowS = performance.now() / 1000;
    for (const d of ['A', 'B'] as DeckId[]) {
      const dk = engine.decks[d];
      if (dk.track && dk.playing && engine.audibility(d) > 0.25) setRec.current.noteTrack(dk.track.id, dk.track.title, dk.track.artist, nowS);
    }
    if (result) {
      const to = (['A', 'B'] as DeckId[]).sort((x, y) => engine.audibility(y) - engine.audibility(x))[0];
      setRec.current.noteTransition(result, engine.other(to).track?.title ?? '?', engine.decks[to].track?.title ?? '?', auto, nowS);
    }
    if (automixRef.current?.on) automixRef.current.tick();
    const next: Tip | null = lesson
      ? { id: `lesson-${lesson.l.id}-${lesson.step}`, text: '', tone: 'info', target: lesson.l.steps[lesson.step]?.target }
      : coachOn
        ? coachTip(s)
        : null;
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

  function advanceLesson() {
    if (!lesson) return;
    setPassed(true);
    setTimeout(() => {
      setPassed(false);
      lessonMem.current = {};
      const cur = lesson;
      if (cur.step + 1 >= cur.l.steps.length) {
        const np = { ...progress, [cur.l.id]: Date.now() };
        storageSet('pista.lessons', JSON.stringify(np));
        setProgress(np);
        const left = LESSONS.filter((x) => !np[x.id]).length;
        toast(`🎉 Lição "${cur.l.title}" concluída!${left ? ` Faltam ${left}.` : ' Você completou a trilha toda!'}`, 3);
        setLesson(null);
      } else setLesson({ l: cur.l, step: cur.step + 1 });
    }, 900);
  }

  const startLesson = (l: Lesson) => {
    setLessonsOpen(false);
    lessonMem.current = {};
    if (l.level > level) {
      setLevel(l.level);
      storageSet('pista.level', String(l.level));
    }
    if (l.setup) {
      if (engine.recording) engine.stopRecording();
      setView('decks');
      l.setup({ engine, tracks, load: (d, t) => loadToDeck(d, t) });
    }
    setLesson({ l, step: 0 });
    engine.resume();
  };

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
      const rep = setRec.current.finish(performance.now() / 1000);
      setReport(rep);
      try {
        const old = JSON.parse(storageGet('pista.sets') ?? '[]');
        storageSet('pista.sets', JSON.stringify([rep, ...old].slice(0, 30)));
      } catch {
        /* ignora */
      }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const where = await saveFile(blob, `pista-set-${stamp}.webm`, { label: 'Gravação do set', ext: 'webm' }).catch(() => null);
      if (where) toast(`Set salvo${where === 'Downloads' ? ' na pasta Downloads' : ''}! Escute depois para ver o que melhorar. 🎧`);
      else toast('Gravação descartada.');
    } else {
      await engine.resume();
      engine.startRecording();
      setRec.current.start(performance.now() / 1000);
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
      const sp = SAMPLER_KEYS.indexOf(k);
      if (sp >= 0 && !e.repeat) {
        e.preventDefault();
        engine.resume();
        samplerRef.current(sp);
        return;
      }
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
          <button className="btn learn" onClick={() => setLessonsOpen(true)} title="Lições guiadas">
            🎓 Aprender <small>{LESSONS.filter((l) => progress[l.id]).length}/{LESSONS.length}</small>
          </button>
          <button className="btn ghost" onClick={() => setVideosOpen(true)} title="Aulas em vídeo organizadas por tema">
            🎬 Aulas
          </button>
          <div className="view-tabs" role="tablist" aria-label="Área">
            <button role="tab" aria-selected={view === 'decks'} className={`tab ${view === 'decks' ? 'on' : ''}`} onClick={() => setView('decks')}>
              🎧 Tocar
            </button>
            <button
              role="tab"
              aria-selected={view === 'studio'}
              className={`tab ${view === 'studio' ? 'on' : ''}`}
              data-coach="studio-tab"
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
            <button className={`btn rec ${engine.recording ? 'on' : ''}`} onClick={toggleRec} title="Gravar o set (R)" data-coach="rec">
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
            <DeckPanel engine={engine} id="A" onDropTrack={(id, tid) => loadById(id, tid)} onDropFiles={(id, f) => addFiles(f, id)} onSyncFail={syncFail} stemJob={stemJob} stemReady={engine.decks.A.track ? stemReady[engine.decks.A.track.id] ?? null : null} onSeparate={separate} />
          </div>
          <Mixer engine={engine} />
          <div className="deck-col">
            <OverviewWaveform deck={engine.decks.B} color="#f472b6" />
            <DeckPanel engine={engine} id="B" onDropTrack={(id, tid) => loadById(id, tid)} onDropFiles={(id, f) => addFiles(f, id)} onSyncFail={syncFail} stemJob={stemJob} stemReady={engine.decks.B.track ? stemReady[engine.decks.B.track.id] ?? null : null} onSeparate={separate} />
          </div>
        </main>

        <AutoBar
          engine={engine}
          running={runningTr}
          automix={automixOn}
          onRun={(id) => {
            const live = (['A', 'B'] as DeckId[]).filter((d) => engine.decks[d].playing).sort((x, y) => engine.audibility(y) - engine.audibility(x))[0];
            if (!live) return toast('Toque uma música primeiro.');
            const err = runTransition(live, live === 'A' ? 'B' : 'A', id);
            if (err) toast(err);
          }}
          onCancel={() => {
            runnerRef.current?.stop(false);
            setNarration('Transição cancelada.');
          }}
          onAutomix={(on) => {
            const a = automixRef.current!;
            if (on) a.start();
            else {
              a.stop();
              runnerRef.current?.stop(false);
            }
            setAutomixOn(on);
          }}
        />

        <Sampler engine={engine} bank={bank} padsRef={samplerRef} onHit={() => (lessonMem.current.sampler = Number(lessonMem.current.sampler ?? 0) + 1)} />

        <div className={`coach ${tip ? `tone-${tip.tone}` : ''}`} role="status" aria-live="polite">
          <span className="coach-icon" aria-hidden>
            {narration && (runningTr || automixOn) ? '🤖' : tip?.tone === 'warn' ? '⚠️' : tip?.tone === 'good' ? '✨' : '💡'}
          </span>
          <span className="coach-text">{narration && (runningTr || automixOn) ? narration : lesson ? 'Lição em andamento — siga o cartão 🎓.' : coachOn ? tip?.text ?? 'Mandou bem! Continue assim.' : 'Dicas do Coach desligadas.'}</span>
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

        <Library engine={engine} tracks={tracks} pending={pending} onLoad={loadToDeck} onFiles={(f) => addFiles(f)} onEdit={openStudio} onRemove={removeTrack} onShowSets={() => setSetsOpen(true)}
          folder={canWatchFolders() ? { name: watched?.name ?? null, needsPermission: !!watched && !watchPerm } : undefined}
          onWatchFolder={async () => {
            const f = await pickFolder();
            if (!f) return;
            setFolder(f);
            scan(f, true);
          }}
          onUnwatchFolder={() => {
            setFolder(null);
            toast('Pasta não é mais vigiada (as músicas continuam na biblioteca).');
          }}
          onReconnectFolder={async () => {
            if (watched && (await hasPermission(watched, true))) scan(watched, true);
          }} selectedId={libSel ?? undefined} onSelect={setLibSel} editing={view === 'studio' ? studioTrack?.id : undefined} />

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
                  <p><kbd>A</kbd>…<kbd>K</kbd> Pads do sampler</p>
                  <p>Duplo clique num botão giratório volta ao centro</p>
                </div>
              </div>
              <button className="btn" onClick={() => setHelp(false)}>
                Fechar
              </button>
            </div>
          </div>
        )}

        {setsOpen && (
          <SetsHistory
            sets={(() => {
              try {
                return JSON.parse(storageGet('pista.sets') ?? '[]') as SetReport[];
              } catch {
                return [];
              }
            })()}
            onOpen={(r) => {
              setSetsOpen(false);
              setReport(r);
            }}
            onClose={() => setSetsOpen(false)}
          />
        )}
        {report && <SetReportModal report={report} onClose={() => setReport(null)} />}
        {videosOpen && (
          <VideosModal
            onClose={() => setVideosOpen(false)}
            onLesson={(id) => {
              const l = LESSONS.find((x) => x.id === id);
              if (l) startLesson(l);
            }}
          />
        )}
        {lessonsOpen && <LessonsModal progress={progress} onStart={startLesson} onClose={() => setLessonsOpen(false)} />}
        {lesson && (
          <LessonCard
            lesson={lesson.l}
            step={lesson.step}
            justPassed={passed}
            onSkip={() => advanceLesson()}
            onExit={() => {
              setLesson(null);
              setPassed(false);
            }}
          />
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
