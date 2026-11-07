import { createContext, useContext, type ReactNode } from 'react';

export type SkillLevel = 1 | 2 | 3;
export const LevelContext = createContext<SkillLevel>(1);

/** Mostra o conteúdo só a partir do nível indicado (revelação progressiva). */
export function Level({ n, children }: { n: SkillLevel; children: ReactNode }) {
  const level = useContext(LevelContext);
  return level >= n ? <>{children}</> : null;
}

export const LEVEL_NAMES: Record<SkillLevel, string> = { 1: 'Iniciante', 2: 'Intermediário', 3: 'Pro' };
