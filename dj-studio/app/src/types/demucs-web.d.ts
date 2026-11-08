declare module 'demucs-web' {
  export const CONSTANTS: { SAMPLE_RATE: number; DEFAULT_MODEL_URL: string; TRACKS: string[] };
  type Stereo = { left: Float32Array; right: Float32Array };
  export class DemucsProcessor {
    constructor(o: {
      ort: unknown;
      sessionOptions?: Record<string, unknown>;
      onProgress?: (p: { progress: number; currentSegment: number; totalSegments: number }) => void;
      onLog?: (phase: string, msg: string) => void;
    });
    session: unknown;
    loadModel(buf: ArrayBuffer | string): Promise<unknown>;
    separate(l: Float32Array, r: Float32Array): Promise<{ drums: Stereo; bass: Stereo; other: Stereo; vocals: Stereo }>;
  }
}
