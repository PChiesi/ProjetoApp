import { useEffect, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { ACTIONS, type Binding } from './midi';

interface Props {
  engine: AudioEngine;
  midi: {
    supported: boolean;
    connected: string[];
    isFlx4: boolean;
    map: Record<string, Binding>;
    learning: string | null;
    lastMsg: string;
  };
  onConnect: () => void;
  onLearn: (action: string | null) => void;
  onResetMap: () => void;
  onClearBinding: (key: string) => void;
  onClose: () => void;
}

export function Settings({ engine, midi, onConnect, onLearn, onResetMap, onClearBinding, onClose }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [showMap, setShowMap] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => setDevices(d.filter((x) => x.kind === 'audiooutput')))
      .catch(() => {});
  }, []);

  const bindingsOf = (action: string) => Object.entries(midi.map).filter(([, b]) => b.action === action);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal settings" role="dialog" aria-label="Som e controladora" onClick={(e) => e.stopPropagation()}>
        <h2>⚙ Som e controladora</h2>

        <section>
          <h3>Saída de som</h3>
          {engine.canChooseDevice && devices.length > 0 && (
            <label className="field">
              <span>Placa de som</span>
              <select value={engine.outputDeviceId} onChange={(e) => engine.setOutputDevice(e.target.value)}>
                <option value="">Padrão do Windows</option>
                {devices
                  .filter((d) => d.deviceId !== 'default' && d.deviceId !== '')
                  .map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Saída ${i + 1}`}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <div className="options">
            {(
              [
                ['normal', 'Só caixa de som', 'Sem pré-escuta no fone.'],
                ['split', 'Fone dividido', 'Fone comum no computador: esquerda = o público, direita = a próxima música (pré-escuta).'],
                ['quad', 'Controladora (4 canais)', engine.quadAvailable ? 'Saídas 1-2 vão para a caixa e 3-4 para o fone da controladora.' : 'A placa escolhida não tem 4 canais — escolha a placa da controladora acima.'],
              ] as const
            ).map(([m, label, desc]) => (
              <label key={m} className={`option ${engine.outputMode === m ? 'on' : ''} ${m === 'quad' && !engine.quadAvailable ? 'disabled' : ''}`}>
                <input type="radio" name="outmode" checked={engine.outputMode === m} disabled={m === 'quad' && !engine.quadAvailable} onChange={() => engine.setOutputMode(m)} />
                <strong>{label}</strong>
                <small>{desc}</small>
              </label>
            ))}
          </div>
          {engine.outputMode !== 'normal' && (
            <label className="field">
              <span>
                Fone: pré-escuta ◀ ▶ público ({Math.round((1 - engine.headMix) * 100)}% / {Math.round(engine.headMix * 100)}%)
              </span>
              <input type="range" min={0} max={1} step={0.01} value={engine.headMix} onChange={(e) => engine.setHeadMix(Number(e.target.value))} />
            </label>
          )}
          <p className="muted">Dica: aperte 🎧 no canal do mixer para ouvir aquele deck no fone antes de soltar para o público.</p>
        </section>

        <section>
          <h3>Controladora</h3>
          {!midi.supported ? (
            <p className="err">Este navegador não suporta controladoras MIDI. Use o Chrome ou o Edge.</p>
          ) : midi.connected.length ? (
            <p>
              <span className="ok-dot" /> Conectada: <b>{midi.connected.join(', ')}</b>
              {midi.isFlx4 ? ' — mapa da DDJ-FLX4 ativo.' : ' — use "Aprender" para ligar os controles.'}
            </p>
          ) : (
            <>
              <p>Ligue a controladora no USB e clique em conectar. O navegador vai pedir permissão.</p>
              <button className="btn primary" onClick={onConnect}>
                Conectar controladora
              </button>
            </>
          )}
          {midi.lastMsg && <p className="muted">Último sinal recebido: {midi.lastMsg}</p>}
          <div className="row-btns">
            <button className="btn" onClick={() => setShowMap((v) => !v)}>
              {showMap ? 'Esconder mapa' : 'Ver / trocar controles'}
            </button>
            <button className="btn ghost" onClick={onResetMap}>
              Restaurar mapa da DDJ-FLX4
            </button>
          </div>
          {midi.learning && (
            <p className="learn-banner">
              🎛 Mexa agora no botão/knob da controladora para: <b>{ACTIONS.find((a) => a.id === midi.learning)?.name}</b>{' '}
              <button className="btn tiny" onClick={() => onLearn(null)}>
                cancelar
              </button>
            </p>
          )}
          {showMap && (
            <>
              <input className="search" placeholder="Filtrar (ex.: Deck A, loop, hot cue)…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <div className="map-list">
                {ACTIONS.filter((a) => a.name.toLowerCase().includes(filter.toLowerCase())).map((a) => {
                  const bs = bindingsOf(a.id).filter(([, b]) => b.kind !== 'lsb');
                  return (
                    <div key={a.id} className={`map-row ${midi.learning === a.id ? 'learning' : ''}`}>
                      <span>{a.name}</span>
                      <span className="map-keys">
                        {bs.length ? bs.map(([k]) => (
                          <code key={k} title="Clique para remover" onClick={() => onClearBinding(k)}>
                            {k} ✕
                          </code>
                        )) : <i className="muted">—</i>}
                      </span>
                      <button className="btn tiny" onClick={() => onLearn(a.id)}>
                        Aprender
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
        <button className="btn" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}
