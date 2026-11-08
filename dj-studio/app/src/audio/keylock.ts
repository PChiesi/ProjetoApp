// Key lock: muda o BPM sem mudar o tom ("sem voz de esquilo").
// Um AudioWorklet de pitch-shift granular (duas leituras com janelas que se completam)
// desfaz a mudança de tom causada pelo playbackRate. Latência fixa e igual nos dois decks,
// então o alinhamento das batidas entre eles não muda.

const WORKLET = `
class PistaPitch extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'pitch', defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: 'k-rate' }];
  }
  constructor(options) {
    super();
    // "transient": nó do Estúdio que pode ser descartado quando a fonte termina
    this.transient = !!(options && options.processorOptions && options.processorOptions.transient);
    this.W = Math.round(sampleRate * 0.05);
    this.L = 1 << 15;
    this.buf = [new Float32Array(this.L), new Float32Array(this.L)];
    this.w = 0;
    this.ph = 0;
    this.mix = 0;
  }
  read(b, d) {
    const L = this.L;
    let x = this.w - d;
    while (x < 0) x += L;
    const i = Math.floor(x);
    const f = x - i;
    return b[i % L] * (1 - f) + b[(i + 1) % L] * f;
  }
  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    // Nó descartável: só "morre" depois que a fonte já tocou e terminou (antes de começar, espera).
    if (input && input.length > 0) this.seen = true;
    else if (this.transient && this.seen) return false;
    const p = params.pitch[0];
    const n = output[0].length;
    const W = this.W;
    const L = this.L;
    const target = Math.abs(p - 1) > 1e-4 ? 1 : 0;
    const dryDelay = W / 2 + 1;
    for (let s = 0; s < n; s++) {
      for (let c = 0; c < 2; c++) {
        const src = input[Math.min(c, input.length - 1)];
        this.buf[c][this.w] = src ? src[s] : 0;
      }
      this.ph += (1 - p) / W;
      this.ph -= Math.floor(this.ph);
      const ph2 = (this.ph + 0.5) % 1;
      const g1 = Math.sin(Math.PI * this.ph) ** 2;
      const g2 = Math.sin(Math.PI * ph2) ** 2;
      this.mix += (target - this.mix) * 0.002;
      for (let c = 0; c < output.length; c++) {
        const b = this.buf[Math.min(c, 1)];
        const dry = this.read(b, dryDelay);
        let wet = dry;
        if (this.mix > 1e-4) wet = this.read(b, this.ph * W + 1) * g1 + this.read(b, ph2 * W + 1) * g2;
        output[c][s] = dry + (wet - dry) * this.mix;
      }
      this.w = (this.w + 1) % L;
    }
    return true;
  }
}
registerProcessor('pista-pitch', PistaPitch);
`;

export async function loadKeyLock(ctx: BaseAudioContext): Promise<boolean> {
  if (!ctx.audioWorklet) return false;
  // Aberto com duplo clique (file://) o navegador só aceita data: URL; em servidor, blob: também serve.
  const urls = [
    () => 'data:application/javascript;base64,' + btoa(WORKLET),
    () => URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })),
  ];
  for (const u of urls) {
    try {
      await ctx.audioWorklet.addModule(u());
      return true;
    } catch {
      /* tenta o próximo */
    }
  }
  return false; // sem AudioWorklet: segue sem key lock
}

export function createShifter(ctx: BaseAudioContext, transient = false): AudioWorkletNode {
  return new AudioWorkletNode(ctx, 'pista-pitch', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { transient } });
}
