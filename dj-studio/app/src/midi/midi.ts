// Controladora MIDI (Web MIDI). Mapa pronto para a Pioneer DDJ-FLX4 + modo "aprender"
// para trocar qualquer controle. As mensagens da FLX4 seguem o mapeamento de referência do
// projeto Mixxx (Pioneer-DDJ-FLX4.midi.xml).

export type Kind = 'button' | 'abs7' | 'msb' | 'lsb' | 'rel';

export interface Binding {
  action: string;
  kind: Kind;
}

/** Chave da mensagem: "status:data1" em hexadecimal (ex.: "90:0b"). */
export const keyOf = (status: number, d1: number) => `${status.toString(16).padStart(2, '0')}:${d1.toString(16).padStart(2, '0')}`;

const LOOP_SIZES = ['0.25', '0.5', '1', '2', '4', '8', '16', '32'];
const JUMPS = [-1, 1, -2, 2, -4, 4, -8, 8];

/** Ações que a controladora pode disparar (com nome em português para a tela de mapeamento). */
export const ACTIONS: { id: string; name: string; kind: Kind }[] = [];
for (const d of ['A', 'B']) {
  ACTIONS.push(
    { id: `${d}.play`, name: `Deck ${d} · Play/Pause`, kind: 'button' },
    { id: `${d}.cue`, name: `Deck ${d} · CUE`, kind: 'button' },
    { id: `${d}.sync`, name: `Deck ${d} · SYNC`, kind: 'button' },
    { id: `${d}.pfl`, name: `Deck ${d} · Fone (pré-escuta)`, kind: 'button' },
    { id: `${d}.load`, name: `Deck ${d} · Carregar música`, kind: 'button' },
    { id: `${d}.tempo`, name: `Deck ${d} · Tempo`, kind: 'msb' },
    { id: `${d}.volume`, name: `Deck ${d} · Volume`, kind: 'msb' },
    { id: `${d}.trim`, name: `Deck ${d} · Ganho`, kind: 'msb' },
    { id: `${d}.high`, name: `Deck ${d} · Agudo`, kind: 'msb' },
    { id: `${d}.mid`, name: `Deck ${d} · Médio`, kind: 'msb' },
    { id: `${d}.low`, name: `Deck ${d} · Grave`, kind: 'msb' },
    { id: `${d}.filter`, name: `Deck ${d} · Filtro`, kind: 'msb' },
    { id: `${d}.jog`, name: `Deck ${d} · Prato (girar)`, kind: 'rel' },
    { id: `${d}.loop4`, name: `Deck ${d} · Loop 4 batidas`, kind: 'button' },
    { id: `${d}.loopExit`, name: `Deck ${d} · Sair do loop`, kind: 'button' },
    { id: `${d}.loopHalf`, name: `Deck ${d} · Loop ÷2`, kind: 'button' },
    { id: `${d}.loopDouble`, name: `Deck ${d} · Loop ×2`, kind: 'button' },
  );
  for (let i = 0; i < 8; i++) ACTIONS.push({ id: `${d}.hotcue${i}`, name: `Deck ${d} · Hot cue ${i + 1}`, kind: 'button' });
  for (const s of LOOP_SIZES) ACTIONS.push({ id: `${d}.beatloop${s}`, name: `Deck ${d} · Loop ${s}`, kind: 'button' });
  JUMPS.forEach((j) => ACTIONS.push({ id: `${d}.jump${j}`, name: `Deck ${d} · Pular ${j > 0 ? '+' : ''}${j}`, kind: 'button' }));
}
for (let i = 0; i < 16; i++) ACTIONS.push({ id: `sampler${i}`, name: `Sampler pad ${i + 1}`, kind: 'button' });
ACTIONS.push(
  { id: 'xfader', name: 'Crossfader', kind: 'msb' },
  { id: 'headMix', name: 'Fone: mistura pré-escuta/master', kind: 'msb' },
  { id: 'browse', name: 'Navegar na biblioteca', kind: 'rel' },
);

/** Mapa da Pioneer DDJ-FLX4. */
export function flx4Map(): Record<string, Binding> {
  const m: Record<string, Binding> = {};
  const add = (status: number, d1: number, action: string, kind: Kind) => (m[keyOf(status, d1)] = { action, kind });
  const decks: [string, number][] = [
    ['A', 0],
    ['B', 1],
  ];
  for (const [d, ch] of decks) {
    const note = 0x90 + ch;
    const cc = 0xb0 + ch;
    const pad = ch === 0 ? 0x97 : 0x99;
    add(note, 0x0b, `${d}.play`, 'button');
    add(note, 0x0c, `${d}.cue`, 'button');
    add(note, 0x58, `${d}.sync`, 'button');
    add(note, 0x54, `${d}.pfl`, 'button');
    add(note, 0x10, `${d}.loop4`, 'button'); // LOOP IN / 4 BEAT
    add(note, 0x4d, `${d}.loopExit`, 'button'); // RELOOP / EXIT
    add(note, 0x51, `${d}.loopHalf`, 'button'); // CUE/LOOP CALL ◀
    add(note, 0x53, `${d}.loopDouble`, 'button'); // CUE/LOOP CALL ▶
    // Faders e knobs: 14 bits (MSB no CC n, LSB no CC n+0x20)
    for (const [n, a] of [
      [0x00, 'tempo'],
      [0x13, 'volume'],
      [0x04, 'trim'],
      [0x07, 'high'],
      [0x0b, 'mid'],
      [0x0f, 'low'],
    ] as [number, string][]) {
      add(cc, n, `${d}.${a}`, 'msb');
      add(cc, n + 0x20, `${d}.${a}`, 'lsb');
    }
    add(0xb6, 0x17 + ch, `${d}.filter`, 'msb'); // knob CFX/filtro
    add(0xb6, 0x37 + ch, `${d}.filter`, 'lsb');
    for (const j of [0x21, 0x22, 0x23]) add(cc, j, `${d}.jog`, 'rel'); // lateral, topo (vinil), topo
    for (let i = 0; i < 8; i++) {
      add(pad, 0x00 + i, `${d}.hotcue${i}`, 'button'); // modo HOT CUE
      add(pad, 0x60 + i, `${d}.beatloop${LOOP_SIZES[i]}`, 'button'); // modo BEAT LOOP
      add(pad, 0x20 + i, `${d}.jump${JUMPS[i]}`, 'button'); // modo BEAT JUMP
      add(pad, 0x30 + i, `sampler${ch * 8 + i}`, 'button'); // modo SAMPLER
    }
  }
  add(0x96, 0x46, 'A.load', 'button');
  add(0x96, 0x47, 'B.load', 'button');
  add(0xb6, 0x40, 'browse', 'rel');
  add(0xb6, 0x1f, 'xfader', 'msb');
  add(0xb6, 0x3f, 'xfader', 'lsb');
  add(0xb6, 0x0c, 'headMix', 'msb');
  add(0xb6, 0x2c, 'headMix', 'lsb');
  return m;
}

/** LEDs da FLX4 (mesmo número do botão). */
export function flx4Leds(): Record<string, [number, number]> {
  const l: Record<string, [number, number]> = {};
  for (const [d, ch] of [
    ['A', 0],
    ['B', 1],
  ] as [string, number][]) {
    l[`${d}.play`] = [0x90 + ch, 0x0b];
    l[`${d}.cue`] = [0x90 + ch, 0x0c];
    l[`${d}.sync`] = [0x90 + ch, 0x58];
    l[`${d}.pfl`] = [0x90 + ch, 0x54];
    for (let i = 0; i < 8; i++) l[`${d}.hotcue${i}`] = [ch === 0 ? 0x97 : 0x99, i];
  }
  return l;
}

/** Converte mensagens cruas em eventos de ação (cuida dos pares MSB/LSB de 14 bits). */
export class MidiDecoder {
  private msb = new Map<string, number>();
  constructor(public map: Record<string, Binding>) {}

  decode(data: Uint8Array | number[]): { action: string; value: number } | null {
    const [st, d1, d2 = 0] = data as number[];
    const status = (st & 0xf0) === 0x80 ? 0x90 | (st & 0x0f) : st; // note-off vira note-on com 0
    const vel = (st & 0xf0) === 0x80 ? 0 : d2;
    const b = this.map[keyOf(status, d1)];
    if (!b) return null;
    switch (b.kind) {
      case 'button':
        return { action: b.action, value: vel > 0 ? 1 : 0 };
      case 'abs7':
        return { action: b.action, value: vel / 127 };
      case 'msb':
        this.msb.set(b.action, vel);
        // Se a controladora não manda LSB, o MSB sozinho já move o controle.
        return { action: b.action, value: (vel << 7) / 16383 };
      case 'lsb': {
        const hi = this.msb.get(b.action) ?? 0;
        return { action: b.action, value: ((hi << 7) + vel) / 16383 };
      }
      case 'rel':
        return { action: b.action, value: vel - 64 };
    }
  }
}

export interface MidiStatus {
  supported: boolean;
  connected: string[];
  sysex: boolean;
}

/** Acesso ao Web MIDI: ouve todas as entradas e fala com a FLX4 (LEDs + keep-alive). */
export class MidiHub {
  access: MIDIAccess | null = null;
  status: MidiStatus = { supported: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator, connected: [], sysex: false };
  onMessage: (data: Uint8Array) => void = () => {};
  onChange: () => void = () => {};
  private leds = new Map<string, number>();
  private keepAlive = 0;

  async connect(): Promise<boolean> {
    if (!this.status.supported) return false;
    try {
      try {
        this.access = await navigator.requestMIDIAccess({ sysex: true });
        this.status.sysex = true;
      } catch {
        this.access = await navigator.requestMIDIAccess();
      }
    } catch {
      return false;
    }
    const bind = () => {
      this.access!.inputs.forEach((inp) => (inp.onmidimessage = (e) => e.data && this.onMessage(e.data)));
      this.status.connected = [...this.access!.inputs.values()].map((i) => i.name ?? 'MIDI');
      this.leds.clear();
      this.onChange();
    };
    this.access.onstatechange = bind;
    bind();
    // A FLX4 entra em "modo demonstração" sem conversa; o Mixxx manda esta consulta a cada 200 ms.
    clearInterval(this.keepAlive);
    if (this.status.sysex)
      this.keepAlive = window.setInterval(() => this.sendAll([0xf0, 0x00, 0x40, 0x05, 0x00, 0x00, 0x04, 0x05, 0x00, 0x50, 0x02, 0xf7]), 200);
    return true;
  }

  get isFlx4() {
    return this.status.connected.some((n) => /flx4|ddj/i.test(n));
  }

  private sendAll(msg: number[]) {
    this.access?.outputs.forEach((o) => {
      try {
        o.send(msg);
      } catch {
        /* saída ocupada */
      }
    });
  }

  /** Acende/apaga um LED (só manda quando muda). */
  led(status: number, d1: number, on: boolean) {
    const k = keyOf(status, d1);
    const v = on ? 0x7f : 0x00;
    if (this.leds.get(k) === v) return;
    this.leds.set(k, v);
    this.sendAll([status, d1, v]);
  }
}
