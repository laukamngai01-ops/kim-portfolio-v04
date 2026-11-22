import { items } from '../selected/data.js';

// Notes describe the individual cut. Durations come from its local playback copy.
const filmDetails = {
  'motorsport/film': { durationSeconds: 51.2, filmNote: 'Ceremony and racing in Hong Kong' },
  'videography/video_bb_exhibition': { durationSeconds: 15.8, filmNote: 'Backstage at the baby expo' },
  'videography/video_youth_ig_reels': { durationSeconds: 42.566667, filmNote: 'Ballet at the barre' },
  'videography/video_lohas_v2': { durationSeconds: 17.133333, filmNote: 'New Year on stage' },
  'videography/video_popcorn': { durationSeconds: 30.033333, filmNote: 'Makeup and pre-show rehearsal' },
  'ai-film/ai_film_new_4': { durationSeconds: 15.1, filmNote: 'Spinning tops in the arena' },
  'ai-film/ai_film_new_3': { durationSeconds: 26.378005, filmNote: 'A handheld fan in the park' },
  'ai-film/ai_film_new_6': { durationSeconds: 21.13, filmNote: 'A pump bottle, lather and water' },
  'after-us/film': { durationSeconds: 21, filmNote: 'Relic, growth, symbiosis' },
};

const videos = items.filter(entry => entry.item.type === 'video');
export const films = videos.map(entry => {
  const { project, projectId, item, index } = entry;
  const series = videos.filter(other => other.projectId === projectId);
  const ordinal = series.indexOf(entry) + 1;
  const suffix = series.length > 1 ? ' / ' + ordinal : '';
  const name = project.title + suffix;
  const nameZh = project.titleZh + suffix;
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
  const isAI = project.disciplines?.includes('ai-film') || project.category === 'AI Film';
  return {
    ...entry, id, ordinal, isAI,
    name, nameZh, title: name, titleZh: nameZh, label: item.label,
    poster: item.image, discPrint: new URL('prints/' + id + '.webp', import.meta.url).href,
    src: item.src, ...filmDetails[item.id],
    projectRole: project.role, role: project.role, index,
  };
});
export const base = new URL('./', import.meta.url);
export const filmsURL = () => new URL('./', base);
export const galleryURL = new URL('../glass/#helix', base);
export const filmURL = (entry, watch = false) => new URL('production/' + entry.id + '/' + (watch ? '?watch=1' : ''), base);

export function resolveView(url) {
  const path = url.pathname.startsWith(base.pathname)
    ? url.pathname.slice(base.pathname.length).replace(/(^|\/)index\.html$/, '').replace(/\/$/, '')
    : null;
  if (path === '' || path === 'ai-films') return { kind: 'browse', legacyAI: path === 'ai-films' };
  const match = path?.match(/^production\/([^/]+)(\/watch)?$/);
  const entry = match && films.find(item => item.id === match[1]);
  if (!entry) return { kind: 'missing' };
  const media = url.searchParams.get('media');
  const mediaIndex = media !== null && /^\d+$/.test(media) && entry.project.items[Number(media)] ? Number(media) : entry.index;
  return { kind: 'detail', entry, mediaIndex, watch: Boolean(match[2]) || url.searchParams.get('watch') === '1' };
}
