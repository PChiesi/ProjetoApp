import { describe, expect, it } from 'vitest';
import { SetRecorder } from './report';

const tr = (stars: 1 | 2 | 3, aligned: number, bassClash = 0) => ({ seconds: 20, aligned, bassClash, clips: 0, stars, message: '' });

describe('relatório pós-set', () => {
  it('registra músicas uma vez só e calcula a média', () => {
    const r = new SetRecorder();
    r.start(0);
    r.noteTrack('a', 'Música A', 'X', 1);
    r.noteTrack('a', 'Música A', 'X', 5);
    r.noteTrack('b', 'Música B', 'Y', 60);
    r.noteTransition(tr(3, 0.95), 'Música A', 'Música B', false, 80);
    r.noteTransition(tr(1, 0.4), 'Música B', 'Música A', false, 200);
    const rep = r.finish(300);
    expect(rep.tracks.map((t) => t.title)).toEqual(['Música A', 'Música B']);
    expect(rep.avgStars).toBe(2);
    expect(rep.transitions[0].at).toBe(60);
    expect(rep.mainTip).toMatch(/alinhamento/);
  });
  it('dica de graves quando eles se somam', () => {
    const r = new SetRecorder();
    r.start(0);
    r.noteTransition(tr(2, 0.95, 0.6), 'A', 'B', false, 50);
    expect(r.finish(100).mainTip).toMatch(/GRAVE/);
  });
  it('transições automáticas não contam na nota', () => {
    const r = new SetRecorder();
    r.start(0);
    r.noteTransition(tr(3, 1), 'A', 'B', true, 50);
    expect(r.finish(100).avgStars).toBe(0);
  });
});
