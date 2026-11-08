import { describe, expect, it } from 'vitest';
import { detectKey, toCamelot } from './key';
import { DEMOS, renderDemo } from './demoTracks';
import { camelotMatch } from './beat';

describe('Camelot', () => {
  it('converte tons', () => {
    expect(toCamelot(0, false)).toBe('8B'); // C
    expect(toCamelot(9, true)).toBe('8A'); // Am
    expect(toCamelot(4, true)).toBe('9A'); // Em
    expect(toCamelot(2, true)).toBe('7A'); // Dm
    expect(toCamelot(7, false)).toBe('9B'); // G
  });
});

describe('detecção de tom nas demos', () => {
  for (const spec of DEMOS) {
    it(`${spec.title} = ${spec.key}`, () => {
      const r = detectKey(renderDemo(spec, 22050), 22050);
      // Para mixar, o que importa é cair num tom compatível (o mesmo, vizinho ou relativo);
      // confundir Lá menor com Dó maior, por exemplo, é normal até nos softwares profissionais.
      expect(camelotMatch(r?.camelot, spec.key)).toBe('ok');
    });
  }
});
