import { describe, expect, it } from 'vitest';
import {
  applyTemplate,
  barLen,
  copyRange,
  deleteRange,
  detectSections,
  duplicateRange,
  extendIntro,
  extendOutro,
  insertAt,
  newProject,
  projectLength,
  snapTime,
  toSource,
  addSound,
  addEffect,
  echoOut,
} from './edit';
import { computeWaveform } from '../audio/analysis';
import { DEMOS, renderDemo } from '../audio/demoTracks';

const g = { bpm: 120, firstBeat: 0 }; // compasso = 2 s
const bar = barLen(g);

describe('edição por blocos', () => {
  it('apaga um trecho e fecha o buraco', () => {
    const p = deleteRange(newProject('t', 100), 10, 20);
    expect(projectLength(p)).toBeCloseTo(90);
    expect(toSource(p, 10)).toBeCloseTo(20); // depois do corte vem o áudio de 20 s
  });

  it('duplica um trecho logo depois dele', () => {
    const p = duplicateRange(newProject('t', 100), 0, 8);
    expect(projectLength(p)).toBeCloseTo(108);
    expect(toSource(p, 9)).toBeCloseTo(1); // 8..16 repete 0..8
    expect(toSource(p, 17)).toBeCloseTo(9);
  });

  it('recortar e colar move um trecho', () => {
    let p = newProject('t', 60);
    const clip = copyRange(p, 0, 4);
    p = deleteRange(p, 0, 4);
    p = insertAt(p, 10, clip);
    expect(projectLength(p)).toBeCloseTo(60);
    expect(toSource(p, 0)).toBeCloseTo(4);
    expect(toSource(p, 11)).toBeCloseTo(1);
  });

  it('não deixa a música vazia', () => {
    const p = deleteRange(newProject('t', 10), 0, 10);
    expect(projectLength(p)).toBeCloseTo(10);
  });

  it('estende intro e final em compassos inteiros', () => {
    let p = extendIntro(newProject('t', 100), g, 8);
    expect(projectLength(p)).toBeCloseTo(100 + 8 * bar);
    p = extendOutro(p, g, 8);
    expect(projectLength(p)).toBeCloseTo(100 + 16 * bar);
  });

  it('encaixa no compasso, mas aceita as pontas', () => {
    expect(snapTime(4.7, g, 'bar', 100)).toBeCloseTo(4);
    expect(snapTime(5.2, g, 'bar', 100)).toBeCloseTo(6);
    expect(snapTime(99.8, g, 'bar', 99.9)).toBeCloseTo(99.9);
    expect(snapTime(0.7, g, 'beat', 100)).toBeCloseTo(0.5);
  });
});

describe('seções e modelos', () => {
  const spec = DEMOS[0];
  const sr = 22050;
  const data = renderDemo(spec, sr);
  const wf = computeWaveform(data, sr);
  const grid = { bpm: spec.bpm, firstBeat: 0 };
  const dur = data.length / sr;
  const sections = detectSections(wf, grid, dur);

  it('acha intro, breakdown e outro na música demo', () => {
    const kinds = sections.map((s) => s.kind);
    expect(kinds[0]).toBe('intro');
    expect(kinds[3]).toBe('break'); // a demo tem breakdown na 4ª frase
    expect(kinds[kinds.length - 1]).toBe('outro');
  });

  it('"Pro baile" tira o breakdown', () => {
    const p = applyTemplate('baile', 't', dur, grid, sections);
    expect(projectLength(p)).toBeCloseTo(dur - 8 * barLen(grid), 1);
  });

  it('"Versão estendida" aumenta 32 compassos', () => {
    const p = applyTemplate('estendida', 't', dur, grid, sections);
    expect(projectLength(p)).toBeCloseTo(dur + 32 * barLen(grid), 1);
  });
});

describe('sons e efeitos acompanham a edição', () => {
  it('apagar antes de um som puxa o som para trás', () => {
    let p = addSound(newProject('t', 100), 'buzina', 50);
    p = deleteRange(p, 10, 20);
    expect(p.sounds[0].at).toBeCloseTo(40);
  });
  it('apagar o trecho do som remove o som', () => {
    let p = addSound(newProject('t', 100), 'buzina', 15);
    p = deleteRange(p, 10, 20);
    expect(p.sounds).toHaveLength(0);
  });
  it('repetir um trecho empurra os efeitos de depois', () => {
    let p = addEffect(newProject('t', 100), 'eco', 30, 34);
    p = duplicateRange(p, 0, 8);
    expect(p.effects[0].t0).toBeCloseTo(38);
    expect(p.effects[0].t1).toBeCloseTo(42);
  });
  it('apagar parte de um efeito encurta o efeito', () => {
    let p = addEffect(newProject('t', 100), 'abafar', 10, 30);
    p = deleteRange(p, 20, 40);
    expect(p.effects[0].t0).toBeCloseTo(10);
    expect(p.effects[0].t1).toBeCloseTo(20);
  });
  it('saída com eco = eco + corte', () => {
    const p = echoOut(newProject('t', 100), g, 50);
    expect(p.effects.map((f) => f.type)).toEqual(['eco', 'corte']);
    expect(p.effects[0].t0).toBeCloseTo(48);
  });
});

import { addLayer, addFxLane, addSoundLane, effectiveVolume, moveClip, removeLayer, setItemGain, splitClip, timelineEnd, updateLane, clipLength } from './edit';

describe('multipista', () => {
  const g120 = { bpm: 120, firstBeat: 0 };
  const src = { trackId: 'x', name: 'Funk', part: 'vocal' as const, bpm: 130, firstBeat: 0.5, duration: 60.5 };

  it('faixa extra entra no BPM do projeto (130 → 120)', () => {
    const p = addLayer(newProject('t', 10), g120, src, 4); // principal curta: quem define o fim é a faixa extra
    const l = p.layers[0];
    expect(l.rate).toBeCloseTo(120 / 130);
    expect(l.clips[0].start).toBeCloseTo(0.5); // começa no "1" da música
    expect(clipLength(l.clips[0], l.rate)).toBeCloseTo(60 / (120 / 130));
    expect(timelineEnd(p, g120)).toBeCloseTo(4 + 60 * (130 / 120));
  });

  it('dobro/metade de BPM conta como o mesmo andamento', () => {
    const p = addLayer(newProject('t', 100), { bpm: 150, firstBeat: 0 }, { ...src, bpm: 75 }, 0);
    expect(p.layers[0].rate).toBeCloseTo(1);
  });

  it('dividir e mover trechos', () => {
    let p = addLayer(newProject('t', 100), g120, { ...src, bpm: 120, firstBeat: 0, duration: 40 }, 0);
    const id = p.layers[0].id;
    p = splitClip(p, id, p.layers[0].clips[0].id, 10);
    expect(p.layers[0].clips.map((c) => [c.at, c.start, c.end])).toEqual([
      [0, 0, 10],
      [10, 10, 40],
    ]);
    p = moveClip(p, id, p.layers[0].clips[1].id, 20);
    expect(p.layers[0].clips[1].at).toBe(20);
  });

  it('apagar trecho da principal puxa as faixas extras', () => {
    let p = addLayer(newProject('t', 100), g120, { ...src, bpm: 120, firstBeat: 0, duration: 40 }, 30);
    p = deleteRange(p, 10, 20);
    expect(p.layers[0].clips[0].at).toBeCloseTo(20);
  });

  it('volume, mudo e solo', () => {
    let p = addSoundLane(newProject('t', 100));
    const s2 = p.soundLanes[1].id;
    p = updateLane(p, 'main', { volume: 0.5 });
    expect(effectiveVolume(p, p.main)).toBe(0.5);
    p = updateLane(p, s2, { solo: true });
    expect(effectiveVolume(p, p.main)).toBe(0); // alguém em solo: o resto cala
    expect(effectiveVolume(p, p.soundLanes[1])).toBe(1);
    p = updateLane(p, s2, { solo: false, mute: true });
    expect(effectiveVolume(p, p.soundLanes[1])).toBe(0);
  });

  it('efeitos por faixa e volume por item', () => {
    let p = addFxLane(newProject('t', 100), 'mix');
    const f2 = p.fxLanes[1].id;
    p = addEffect(p, 'eco', 0, 4);
    p = addEffect(p, 'eco', 0, 4, f2); // mesmo efeito em outra faixa: os dois ficam
    expect(p.effects).toHaveLength(2);
    p = addSound(p, 'buzina', 2);
    p = setItemGain(p, p.sounds[0].id, 0.4);
    expect(p.sounds[0].gain).toBe(0.4);
  });

  it('remover faixa extra redireciona os efeitos dela para "tudo"', () => {
    let p = addLayer(newProject('t', 100), g120, src, 0);
    const id = p.layers[0].id;
    p = addFxLane(p, id);
    p = removeLayer(p, id);
    expect(p.layers).toHaveLength(0);
    expect(p.fxLanes[1].target).toBe('mix');
  });
});
