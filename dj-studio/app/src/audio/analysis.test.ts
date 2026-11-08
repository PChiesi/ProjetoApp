import { describe, expect, it } from 'vitest';
import { detectTempo, computeWaveform } from './analysis';
import { DEMOS, renderDemo } from './demoTracks';

describe('detecção de BPM nas músicas demo', () => {
  for (const spec of DEMOS) {
    it(`${spec.title} (${spec.bpm} BPM)`, () => {
      const sr = 22050;
      const data = renderDemo(spec, sr);
      const r = detectTempo(data, sr);
      expect(r.bpm).toBe(spec.bpm);
      // primeira batida no início (até 15 ms de tolerância)
      const beat = 60 / spec.bpm;
      const off = r.firstBeat % beat;
      expect(Math.min(off, beat - off)).toBeLessThan(0.015);
      // e o "1" do compasso no lugar certo
      const bar = 4 * beat;
      const offBar = r.firstBeat % bar;
      expect(Math.min(offBar, bar - offBar)).toBeLessThan(0.015);
    });
  }
});

describe('forma de onda', () => {
  it('gera bandas normalizadas', () => {
    const sr = 22050;
    const wf = computeWaveform(renderDemo(DEMOS[0], sr), sr);
    expect(wf.low.length).toBeGreaterThan(100);
    expect(Math.max(...wf.low)).toBeLessThanOrEqual(1);
  });
});
