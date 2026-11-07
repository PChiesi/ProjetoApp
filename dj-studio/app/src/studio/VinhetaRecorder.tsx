import { useEffect, useRef, useState } from 'react';
import { recordMic, trimAndNormalize, type SoundAsset } from './sounds';

interface Props {
  ctx: AudioContext;
  out: AudioNode;
  onSave: (s: SoundAsset) => void;
  onClose: () => void;
}

type Phase = 'pronta' | 'contagem' | 'gravando' | 'processando' | 'ouvir' | 'erro';

/** Grava a vinheta pelo microfone: 3-2-1, grava, corta o silêncio, normaliza e salva. */
export function VinhetaRecorder({ ctx, out, onSave, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('pronta');
  const [count, setCount] = useState(3);
  const [secs, setSecs] = useState(0);
  const [name, setName] = useState('Minha vinheta');
  const [error, setError] = useState('');
  const rec = useRef<Awaited<ReturnType<typeof recordMic>> | null>(null);
  const buf = useRef<AudioBuffer | null>(null);
  const meter = useRef<HTMLDivElement>(null);
  const preview = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    if (phase !== 'gravando') return;
    const t0 = performance.now();
    let id = 0;
    const loop = () => {
      setSecs((performance.now() - t0) / 1000);
      if (meter.current && rec.current) meter.current.style.setProperty('--lvl', String(Math.min(1, rec.current.level() * 1.4)));
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [phase]);

  useEffect(() => () => preview.current?.stop(), []);

  const start = async () => {
    try {
      rec.current = await recordMic();
      // a gravação já começou; a contagem só ajuda ela a se preparar (o silêncio é cortado depois)
      setPhase('contagem');
      for (let i = 3; i >= 1; i--) {
        setCount(i);
        await new Promise((r) => setTimeout(r, 700));
      }
      setPhase('gravando');
    } catch {
      setError('Não consegui usar o microfone. Verifique se o navegador tem permissão (ícone de cadeado/câmera na barra de endereço).');
      setPhase('erro');
    }
  };

  const stop = async () => {
    if (!rec.current) return;
    setPhase('processando');
    try {
      const blob = await rec.current.stop();
      const raw = await ctx.decodeAudioData(await blob.arrayBuffer());
      buf.current = trimAndNormalize(ctx, raw);
      setPhase('ouvir');
      play();
    } catch {
      setError('A gravação falhou. Tente de novo.');
      setPhase('erro');
    }
  };

  const play = () => {
    preview.current?.stop();
    if (!buf.current) return;
    const s = ctx.createBufferSource();
    s.buffer = buf.current;
    s.connect(out);
    s.start();
    preview.current = s;
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal vinheta" role="dialog" aria-label="Gravar vinheta" onClick={(e) => e.stopPropagation()}>
        <h2>🎤 Gravar vinheta</h2>
        {phase === 'pronta' && (
          <>
            <p>Fale ou cante a sua vinheta — por exemplo o seu nome de DJ. Use fone de ouvido para a música não vazar no microfone.</p>
            <button className="btn primary" onClick={start}>
              Começar (3, 2, 1…)
            </button>
          </>
        )}
        {phase === 'contagem' && <div className="countdown">{count}</div>}
        {phase === 'gravando' && (
          <>
            <div className="rec-live">
              <span className="rec-dot" /> Gravando… {secs.toFixed(1)} s
            </div>
            <div className="mic-meter" ref={meter} />
            <button className="btn rec on" onClick={stop}>
              ■ Parar
            </button>
          </>
        )}
        {phase === 'processando' && <p>Cortando o silêncio e ajustando o volume…</p>}
        {phase === 'ouvir' && buf.current && (
          <>
            <p>
              Ficou com {buf.current.duration.toFixed(1)} s. Escute e dê um nome:
            </p>
            <label className="field">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} />
            </label>
            <div className="row-btns">
              <button className="btn" onClick={play}>
                ▶ Ouvir
              </button>
              <button className="btn" onClick={() => setPhase('pronta')}>
                ↺ Gravar de novo
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  onSave({ id: `user-${Date.now()}`, name: name.trim() || 'Vinheta', icon: '🎤', buffer: buf.current!, user: true });
                  onClose();
                }}
              >
                Salvar vinheta
              </button>
            </div>
          </>
        )}
        {phase === 'erro' && (
          <>
            <p className="err">{error}</p>
            <button className="btn" onClick={() => setPhase('pronta')}>
              Tentar de novo
            </button>
          </>
        )}
        <button className="btn ghost" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}
