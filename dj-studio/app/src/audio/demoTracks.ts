// Músicas de demonstração sintetizadas na hora (100% livres de direitos).
// Cada uma tem estrutura de DJ: intro só com batida, partes principais, breakdown e outro,
// em frases de 8 compassos — perfeitas para treinar as primeiras transições.

export interface DemoSpec {
  id: string;
  title: string;
  artist: string;
  genre: 'Pop' | 'Rock' | 'Funk';
  bpm: number;
  key: string; // Camelot
  /** Notas fundamentais (MIDI) dos acordes, 1 por compasso, em ciclo de 4. */
  chords: number[];
  minor: boolean;
  style: 'pop' | 'rock' | 'tamborzao' | 'mandelao';
}

export const DEMOS: DemoSpec[] = [
  { id: 'demo-pop', title: 'Verão em Neon', artist: 'Pista Demo', genre: 'Pop', bpm: 120, key: '8A', chords: [57, 53, 48, 55], minor: true, style: 'pop' },
  { id: 'demo-rock', title: 'Garagem 77', artist: 'Pista Demo', genre: 'Rock', bpm: 124, key: '9A', chords: [52, 48, 55, 50], minor: true, style: 'rock' },
  { id: 'demo-funk', title: 'Tamborzão da Vila', artist: 'Pista Demo', genre: 'Funk', bpm: 130, key: '7A', chords: [50, 50, 46, 45], minor: true, style: 'tamborzao' },
  { id: 'demo-mandelao', title: 'Baile 150', artist: 'Pista Demo', genre: 'Funk', bpm: 150, key: '8A', chords: [45, 45, 41, 43], minor: true, style: 'mandelao' },
];

// Seções: [nome, compassos, camadas]
type Layer = 'kick' | 'snare' | 'hat' | 'bass' | 'chords' | 'perc';
const STRUCTURE: [string, number, Layer[]][] = [
  ['Intro', 8, ['kick', 'hat', 'perc']],
  ['Parte A', 8, ['kick', 'snare', 'hat', 'bass', 'perc']],
  ['Refrão', 8, ['kick', 'snare', 'hat', 'bass', 'chords', 'perc']],
  ['Breakdown', 8, ['chords', 'hat']],
  ['Refrão', 8, ['kick', 'snare', 'hat', 'bass', 'chords', 'perc']],
  ['Outro', 8, ['kick', 'hat', 'perc']],
];

export function demoSections(): { name: string; startBeat: number; bars: number }[] {
  let beat = 0;
  return STRUCTURE.map(([name, bars]) => {
    const s = { name, startBeat: beat, bars };
    beat += bars * 4;
    return s;
  });
}

// Padrões em 16 avos por compasso (1 = toca).
const PATTERNS: Record<DemoSpec['style'], Partial<Record<Layer, string>>> = {
  pop: {
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: '..x...x...x...x.',
    perc: '..........x.....',
    bass: 'x..x..x.x..x..x.',
  },
  rock: {
    kick: 'x.....x.x.......',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.x.',
    perc: '...............x',
    bass: 'x.x.x.x.x.x.x.x.',
  },
  // Tamborzão: a "levada" clássica do funk carioca.
  tamborzao: {
    kick: 'x..x..x...x..x..',
    snare: '....x.......x...',
    hat: '..x...x...x...x.',
    perc: 'x..x..x.x..x..x.',
    bass: 'x.....x...x.....',
  },
  // Mandelão / 150: batida mais seca e acelerada.
  mandelao: {
    kick: 'x..x..x.x..x..x.',
    snare: '....x..x....x...',
    hat: 'x.xxx.xxx.xxx.xx',
    perc: '..x.......x..x..',
    bass: 'x..x......x.....',
  },
};

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Renderiza a música em mono. Retorna as amostras e a duração. */
export function renderDemo(spec: DemoSpec, sampleRate = 44100): Float32Array {
  const beat = 60 / spec.bpm;
  const step = beat / 4;
  const totalBars = STRUCTURE.reduce((a, s) => a + s[1], 0);
  const lengthSec = totalBars * 4 * beat + 1.5;
  const out = new Float32Array(Math.ceil(lengthSec * sampleRate));
  const rnd = mulberry32(spec.bpm * 97 + spec.chords[0]);
  const noise = new Float32Array(sampleRate); // 1 s de ruído reaproveitado
  for (let i = 0; i < noise.length; i++) noise[i] = rnd() * 2 - 1;
  const pat = PATTERNS[spec.style];
  const rock = spec.style === 'rock';
  const funk = spec.style === 'tamborzao' || spec.style === 'mandelao';

  const add = (t0: number, dur: number, fn: (t: number, i: number) => number) => {
    const s0 = Math.floor(t0 * sampleRate);
    const n = Math.min(out.length - s0, Math.floor(dur * sampleRate));
    for (let i = 0; i < n; i++) out[s0 + i] += fn(i / sampleRate, i);
  };

  const kick = (t0: number, amp: number) => {
    let ph = 0;
    add(t0, 0.4, (t) => {
      const f = 45 + 110 * Math.exp(-t * 28);
      ph += (2 * Math.PI * f) / sampleRate;
      return Math.tanh(Math.sin(ph) * 1.8) * Math.exp(-t * (funk ? 6 : 9)) * amp;
    });
  };
  const snare = (t0: number, amp: number) => {
    const off = Math.floor(rnd() * 20000);
    add(t0, 0.25, (t, i) => (noise[(off + i) % noise.length] * 0.6 * Math.exp(-t * (rock ? 14 : 22)) + Math.sin(2 * Math.PI * 190 * t) * 0.35 * Math.exp(-t * 30)) * amp);
  };
  const hat = (t0: number, amp: number, open: boolean) => {
    const off = Math.floor(rnd() * 20000);
    let prev = 0;
    add(t0, open ? 0.2 : 0.06, (t, i) => {
      const x = noise[(off + i) % noise.length];
      const y = x - prev; // passa-alta simples
      prev = x;
      return y * 0.18 * Math.exp(-t * (open ? 18 : 70)) * amp;
    });
  };
  const perc = (t0: number, amp: number, pitch: number) => {
    let ph = 0;
    add(t0, 0.25, (t) => {
      const f = pitch * (1 + 0.6 * Math.exp(-t * 25));
      ph += (2 * Math.PI * f) / sampleRate;
      return Math.sin(ph) * Math.exp(-t * 14) * 0.45 * amp;
    });
  };
  const bass = (t0: number, dur: number, note: number) => {
    const f = mtof(note - 12);
    let ph = 0;
    add(t0, dur, (t) => {
      ph += (2 * Math.PI * f) / sampleRate;
      const env = Math.min(1, t * 200) * Math.exp(-t * (funk ? 2.5 : 4));
      const wave = funk ? Math.sin(ph) : Math.tanh(Math.sin(ph) * 2 + 0.4 * Math.sin(2 * ph));
      return wave * env * 0.5;
    });
  };
  const chord = (t0: number, dur: number, root: number) => {
    const third = spec.minor ? 3 : 4;
    const notes = rock ? [root, root + 7, root + 12] : [root + 12, root + 12 + third, root + 19];
    const fs = notes.map(mtof);
    const phs = notes.map(() => 0);
    let lp = 0;
    add(t0, dur, (t) => {
      let v = 0;
      for (let k = 0; k < fs.length; k++) {
        phs[k] += fs[k] / sampleRate;
        v += (phs[k] % 1) * 2 - 1; // dente de serra
      }
      if (rock) v = Math.tanh(v * 2.5) * 0.6; // "guitarra" distorcida
      lp += 0.08 * (v - lp);
      const env = Math.min(1, t * 30) * Math.min(1, (dur - t) * 20);
      return lp * env * 0.16;
    });
  };

  let bar = 0;
  for (const [, bars, layers] of STRUCTURE) {
    const has = (l: Layer) => layers.includes(l);
    for (let b = 0; b < bars; b++, bar++) {
      const t0 = bar * 4 * beat;
      const root = spec.chords[bar % 4];
      for (let s = 0; s < 16; s++) {
        const t = t0 + s * step;
        if (has('kick') && pat.kick?.[s] === 'x') kick(t, s % 4 === 0 ? 1 : 0.8);
        if (has('snare') && pat.snare?.[s] === 'x') snare(t, funk ? 1.8 : 0.9);
        if (has('hat') && pat.hat?.[s] === 'x') hat(t, s % 4 === 2 ? 1 : 0.7, !funk && s % 8 === 6);
        if (has('perc') && pat.perc?.[s] === 'x') perc(t, funk ? 0.3 : 0.8, funk ? (s % 3 === 0 ? 180 : 240) : 320);
        if (has('bass') && pat.bass?.[s] === 'x') bass(t, step * (funk ? 4 : 2), root + (s >= 8 && !funk ? 7 : 0));
      }
      if (has('chords')) {
        if (spec.style === 'pop') for (let k = 0; k < 4; k++) chord(t0 + k * beat + step * 2, beat * 0.45, root);
        else if (rock) for (let k = 0; k < 8; k++) chord(t0 + k * beat * 0.5, beat * 0.45, root);
        else chord(t0, beat * 4, root);
      }
    }
  }

  let peak = 1e-9;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = 0.89 / peak;
  for (let i = 0; i < out.length; i++) out[i] *= g;
  return out;
}
