import { describe, expect, it } from 'vitest';
import { beatInfo, camelotMatch, phaseDelta, syncRate } from './beat';

describe('beat', () => {
  const grid = { bpm: 120, firstBeat: 0.1 };
  it('conta batidas, compassos e frases', () => {
    expect(beatInfo(grid, 0.1)).toMatchObject({ beatInBar: 1, barInPhrase: 1, phrase: 1, beatsToNextPhrase: 32 });
    expect(beatInfo(grid, 0.1 + 0.5 * 5)).toMatchObject({ beatInBar: 2, barInPhrase: 2 });
    expect(beatInfo(grid, 0.1 + 0.5 * 32)).toMatchObject({ phrase: 2, barInPhrase: 1 });
  });
  it('fase circular', () => {
    expect(phaseDelta(0.95, 0.05)).toBeCloseTo(-0.1);
  });
  it('sync usa dobro/metade quando necessário', () => {
    expect(syncRate(124, 120)).toBeCloseTo(120 / 124);
    expect(syncRate(150, 75)).toBeCloseTo(1);
    expect(syncRate(100, 200)).toBeCloseTo(1);
  });
  it('camelot', () => {
    expect(camelotMatch('8A', '9A')).toBe('ok');
    expect(camelotMatch('8A', '8B')).toBe('ok');
    expect(camelotMatch('8A', '10A')).toBe('risco');
    expect(camelotMatch('8A', '2B')).toBe('conflito');
  });
});
