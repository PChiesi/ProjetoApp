// Áudio de uma música inteira ou só de uma parte (via stems): vocal, instrumental, batida + baixo.
import { STEM_IDS, type StemId, type Track } from '../audio/engine';
import { ensureBuffer } from '../audio/library';
import { hasStems, loadStems } from '../audio/stems';
import type { PartMode } from './edit';

export const PART_LABEL: Record<PartMode, string> = { tudo: 'Música inteira', vocal: 'Só vocal (acapella)', instrumental: 'Instrumental (sem voz)', batida: 'Só batida + baixo' };
export const PART_SHORT: Record<PartMode, string> = { tudo: 'inteira', vocal: 'vocal', instrumental: 'instrumental', batida: 'batida+baixo' };
const PART_STEMS: Record<Exclude<PartMode, 'tudo'>, StemId[]> = { vocal: ['vocals'], instrumental: ['drums', 'bass', 'other'], batida: ['drums', 'bass'] };

const cache = new Map<string, AudioBuffer>();

export async function partBuffer(ctx: AudioContext, t: Track, part: PartMode): Promise<AudioBuffer | null> {
  if (part === 'tudo') return ensureBuffer(ctx, t);
  const key = `${t.id}:${part}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const set = await loadStems(ctx, t.id);
  if (!set) return null;
  const ref = set[STEM_IDS[0]];
  const out = ctx.createBuffer(2, ref.length, ref.sampleRate);
  for (const k of PART_STEMS[part])
    for (let c = 0; c < 2; c++) {
      const src = set[k].getChannelData(c);
      const dst = out.getChannelData(c);
      for (let i = 0; i < dst.length; i++) dst[i] += src[i];
    }
  cache.set(key, out);
  return out;
}

export { hasStems };
