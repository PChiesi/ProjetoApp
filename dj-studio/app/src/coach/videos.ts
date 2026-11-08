// Acervo de aulas em vídeo (links do YouTube), organizado por tema e na ordem sugerida.
// Curadoria feita a partir de buscas no YouTube em nov/2026. Vídeos podem sair do ar com o tempo:
// cada tema também tem um link "Buscar mais" que sempre funciona.

export type Lang = 'pt' | 'en';

export interface Video {
  id: string; // ID do YouTube
  title: string;
  lang: Lang;
  short?: boolean;
  note?: string;
}

export interface VideoTopic {
  id: string;
  title: string;
  icon: string;
  why: string;
  /** Lição do app relacionada (para praticar depois de assistir). */
  lesson?: string;
  search: string;
  videos: Video[];
}

export const youtubeUrl = (v: Video) => (v.short ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`);
export const searchUrl = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

export const VIDEO_TOPICS: VideoTopic[] = [
  {
    id: 'basico',
    title: 'Primeiros passos',
    icon: '▶',
    why: 'O básico de toda mixagem: ganho, fone, troca de grave e a primeira transição.',
    lesson: 'crossfader',
    search: 'como mixar dj iniciante passo a passo',
    videos: [
      { id: 'Qjvub7IjE_A', title: 'Passo a passo para mixagem básica DJ', lang: 'pt', note: 'qualidade da música, ganho, fone e troca de grave' },
      { id: '8T6RTTBwtH0', title: 'Passo a passo: sua primeira transição DJ', lang: 'pt' },
      { id: '5AagIzFXk9s', title: 'Vídeo aula AIMEC – Como mixar duas músicas', lang: 'pt', note: 'mostra o processo num mixer' },
      { id: 'ZGezGV5nu6c', title: 'Aprenda como fazer uma mixagem de DJ', lang: 'pt' },
      { id: 'ByMRE1_2Es4', title: 'Comece a mixar agora! Guia de mixagem básica (Virtual DJ)', lang: 'pt', note: 'feito no Virtual DJ, mas os conceitos são os mesmos da Pista' },
    ],
  },
  {
    id: 'beatmatch',
    title: 'Beatmatching (alinhar as batidas)',
    icon: '🔗',
    why: 'Deixar duas músicas no mesmo BPM e com as batidas juntas — com SYNC e de ouvido.',
    lesson: 'sync',
    search: 'beatmatching dj tutorial',
    videos: [
      { id: 'ASUiL2pJp7w', title: '5 Steps To Your First Beat Match', lang: 'en' },
      { id: 'QM74Bc3PsuM', title: 'How to beat match – How to DJ for beginners', lang: 'en' },
      { id: '8LWLJF7i8ZI', title: 'Beat Matching by Ear for Beginners', lang: 'en', note: 'por que aprender sem o SYNC' },
      { id: '8_erWzDmlj4', title: 'Learn to DJ the Real Way: Beat Matching, Phrasing & Mixing Without Visuals', lang: 'en' },
    ],
  },
  {
    id: 'eq',
    title: 'EQ e troca de graves',
    icon: '🎚',
    why: 'O segredo de uma mixagem limpa: nunca dois graves cheios juntos.',
    lesson: 'eq',
    search: 'dj eq bass swap tutorial',
    videos: [
      { id: 'C-5qFyU9QNU', title: '2 DJ Transition Styles and When to Swap Your Basses', lang: 'en' },
      { id: 'kx2fqoaHNbk', title: '3 DJ EQ Mix Techniques – Quick Tutorial', lang: 'en' },
      { id: 'GrEEQjRq9Wc', title: 'Beginner DJ mixing lesson using the low, mid and high EQ', lang: 'en' },
    ],
  },
  {
    id: 'transicoes',
    title: 'Transições',
    icon: '⇄',
    why: 'Jeitos diferentes de passar de uma música para a outra, inclusive músicas sem intro.',
    lesson: 'frase',
    search: 'transições dj tutorial',
    videos: [
      { id: 'R-tsx_hV6Ck', title: '7 Pro DJ Transitions That Instantly Improve Your Mixes', lang: 'en' },
      { id: 'hIGI9P0LEQ8', title: 'DJ Transitions: How to Mix Songs Perfectly Every Time', lang: 'en', note: 'do corte simples à mixagem por frases' },
      { id: 'uf6M7qzDX18', title: 'DJ Better – How to use the crossfader', lang: 'en' },
      { id: 'EkPde4DW9Mw', title: 'Mixagem sem limites: LOOP para transições em músicas sem intro', lang: 'pt' },
      { id: 'GZpIIUuVpMI', title: 'Como mixar músicas sem introdução (Virtual DJ)', lang: 'pt' },
    ],
  },
  {
    id: 'funk',
    title: 'Funk',
    icon: '🔥',
    why: 'Entradas e saídas no funk com loops — e o corte seco quando o BPM muda.',
    lesson: 'corte',
    search: 'como mixar funk dj tutorial',
    videos: [{ id: 'IQd3rydim6w', title: 'Como tocar funk na controladora', lang: 'pt', note: 'entradas e saídas usando loops' }],
  },
  {
    id: 'efeitos',
    title: 'Efeitos',
    icon: '◎',
    why: 'Eco, reverb e companhia: quando e como usar sem exagerar.',
    lesson: 'saida-eco',
    search: 'dj efeitos echo reverb tutorial',
    videos: [
      { id: 'mvYMZc6jgvg', title: 'Emergency Exit Transitions: Echo and Reverb Out (rekordbox)', lang: 'en' },
      { id: 'N2kTkXhh5g4', title: 'Emergency Exit Transitions: Echo and Reverb Out (Virtual DJ)', lang: 'en' },
      { id: 'q1eFoIl4wVI', title: 'Rekordbox: painel de efeitos Beat FX', lang: 'pt' },
      { id: 'Mzlx0xTXxiw', title: 'DJ Effects: Echo, Reverb and Spiral explained', lang: 'en', short: true },
    ],
  },
  {
    id: 'cues',
    title: 'Hot cues e loops',
    icon: '🎯',
    why: 'Marcar os pontos certos da música e repetir trechos para ganhar tempo.',
    lesson: 'hotcue',
    search: 'dj hot cues loops tutorial',
    videos: [
      { id: 'IRXIZdO8cD0', title: 'How & Where To Set Hot Cues For Quick Mixing', lang: 'en' },
      { id: 'uy_aHvFjmXs', title: 'How to set hot cues while mixing live', lang: 'en' },
    ],
  },
  {
    id: 'tom',
    title: 'Mixagem harmônica (tom)',
    icon: '🎼',
    why: 'A roda de Camelot: por que algumas músicas combinam e outras "brigam".',
    lesson: 'harmonia',
    search: 'harmonic mixing camelot wheel dj',
    videos: [
      { id: 'q1eCtkmy_JM', title: 'How To Mix In Key: The Complete Harmonic Mixing Guide For DJs', lang: 'en' },
      { id: '7BWKH-0EKM4', title: 'DJ Better – How to mix in key (the Camelot Wheel)', lang: 'en' },
      { id: 'Ypou-YcnCzM', title: 'The Ultimate Guide to Mixing in Key for DJs', lang: 'en', note: 'do básico até mudanças de energia' },
    ],
  },
  {
    id: 'remix',
    title: 'Remix, acapella e mashup',
    icon: '🎛',
    why: 'Separar vocal e instrumental, juntar músicas e fazer a sua versão — dá para fazer tudo no Estúdio da Pista.',
    lesson: 'edit',
    search: 'como fazer remix mashup acapella dj',
    videos: [
      { id: 'FEsDsuD9D14', title: 'How to Find & Prepare Acapellas For DJing', lang: 'en' },
      { id: '5pEA7m9xRHA', title: 'How to use Acapellas to Mix in a DJ Set', lang: 'en' },
      { id: 'aYD36LJG3ZQ', title: 'How to mashup songs with AI Stem separation', lang: 'en', note: 'mesma ideia dos stems da Pista' },
      { id: 'Wa7_A1bjus4', title: 'How to Make Mashup Songs! (Easy Tutorial)', lang: 'en' },
      { id: 'KBNNKzFPd2k', title: 'Como remixar qualquer música facilmente', lang: 'pt' },
      { id: 'SYB-Rc7toko', title: 'Como remixar qualquer música em 10 minutos (FL Studio)', lang: 'pt', note: 'produção musical, um passo além' },
      { id: 'YmtXV6kvLdg', title: 'Como fazer um remix em qualquer estilo (FL Studio)', lang: 'pt', note: 'produção musical, um passo além' },
    ],
  },
];
