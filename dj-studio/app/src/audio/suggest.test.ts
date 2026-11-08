import { describe, expect, it } from 'vitest';
import { suggestNext } from './suggest';

const t = (id: string, bpm: number, key: string, genre = 'Pop', energy = 0.5) => ({ id, bpm, key, genre, energy });

describe('sugestão da próxima música', () => {
  const cur = t('cur', 120, '8A');
  const all = [cur, t('igual', 121, '9A'), t('longe', 150, '2B', 'Funk'), t('tomruim', 120, '3B'), t('dobro', 60, '8A')];
  it('prefere BPM e tom compatíveis', () => {
    const r = suggestNext(cur, all, new Set());
    expect(r[0].id).toBe('igual');
    expect(r[0].reasons).toContain('tom combina');
    expect(r[r.length - 1].id).toBe('longe');
  });
  it('entende dobro/metade de BPM', () => {
    const r = suggestNext(cur, all, new Set());
    expect(r.findIndex((x) => x.id === 'dobro')).toBeLessThan(r.findIndex((x) => x.id === 'tomruim'));
  });
  it('joga para o fim o que já tocou', () => {
    const r = suggestNext(cur, all, new Set(['igual']));
    expect(r[0].id).not.toBe('igual');
  });
});
