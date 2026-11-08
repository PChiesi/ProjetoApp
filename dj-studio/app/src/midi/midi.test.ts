import { describe, expect, it } from 'vitest';
import { flx4Map, MidiDecoder } from './midi';

describe('DDJ-FLX4', () => {
  const dec = new MidiDecoder(flx4Map());
  it('play do deck 1 e 2', () => {
    expect(dec.decode([0x90, 0x0b, 0x7f])).toEqual({ action: 'A.play', value: 1 });
    expect(dec.decode([0x91, 0x0b, 0x00])).toEqual({ action: 'B.play', value: 0 });
    expect(dec.decode([0x81, 0x0b, 0x40])).toEqual({ action: 'B.play', value: 0 }); // note-off
  });
  it('fader de 14 bits (MSB + LSB)', () => {
    dec.decode([0xb0, 0x13, 0x40]);
    const r = dec.decode([0xb0, 0x33, 0x00]);
    expect(r?.action).toBe('A.volume');
    expect(r?.value).toBeCloseTo(0.5, 2);
  });
  it('crossfader e filtro', () => {
    expect(dec.decode([0xb6, 0x1f, 0x7f])?.action).toBe('xfader');
    expect(dec.decode([0xb6, 0x18, 0x40])?.action).toBe('B.filter');
  });
  it('prato é relativo (centro 64)', () => {
    expect(dec.decode([0xb1, 0x22, 0x43])).toEqual({ action: 'B.jog', value: 3 });
  });
  it('pads nos modos hot cue, loop e sampler', () => {
    expect(dec.decode([0x97, 0x02, 0x7f])?.action).toBe('A.hotcue2');
    expect(dec.decode([0x99, 0x64, 0x7f])?.action).toBe('B.beatloop4');
    expect(dec.decode([0x99, 0x31, 0x7f])?.action).toBe('sampler9');
  });
});
