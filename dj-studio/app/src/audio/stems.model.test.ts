// Teste com o MODELO REAL de separação (HTDemucs). Roda no GitHub Actions, que baixa o modelo
// (~172 MB) e define STEMS_MODEL. Localmente é pulado se a variável não existir.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DemucsProcessor } from 'demucs-web';
import { DEMOS, renderDemo } from './demoTracks';

const MODEL = process.env.STEMS_MODEL;
const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

describe.skipIf(!MODEL)('stems com o modelo HTDemucs', () => {
  it('separa uma música demo em 4 partes que somam a música original', async () => {
    const pkg = 'onnxruntime-node'; // instalado só no job de CI
    const ort = await import(/* @vite-ignore */ pkg);
    const proc = new DemucsProcessor({ ort, sessionOptions: { executionProviders: ['cpu'], graphOptimizationLevel: 'basic' } });
    const buf = readFileSync(MODEL!);
    await proc.loadModel(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

    // 12 s do refrão do tamborzão (bateria + baixo + acordes, sem voz)
    const sr = 44100;
    const full = renderDemo(DEMOS[2], sr);
    const start = Math.floor(((16 * 4 * 60) / DEMOS[2].bpm) * sr);
    const clip = full.slice(start, start + 12 * sr);
    const t0 = Date.now();
    const r = await proc.separate(clip, clip);
    const secs = (Date.now() - t0) / 1000;

    const e = { vocals: rms(r.vocals.left), drums: rms(r.drums.left), bass: rms(r.bass.left), other: rms(r.other.left) };
    const sum = new Float32Array(clip.length);
    for (const k of ['vocals', 'drums', 'bass', 'other'] as const) for (let i = 0; i < clip.length; i++) sum[i] += r[k].left[i];
    const err = new Float32Array(clip.length).map((_, i) => sum[i] - clip[i]);
    console.log(`stems: ${JSON.stringify(e)} | erro da soma ${(rms(err) / rms(clip)).toFixed(3)} | ${secs.toFixed(1)} s na CPU`);

    expect(r.drums.left.length).toBe(clip.length);
    expect(rms(err) / rms(clip)).toBeLessThan(0.35); // as 4 partes somadas ≈ música original
    expect(e.drums).toBeGreaterThan(e.vocals); // música sem voz: quase nada no vocal
    expect(e.drums + e.bass + e.other).toBeGreaterThan(3 * e.vocals);
  }, 600_000);
});
