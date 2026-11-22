import { filmsURL } from './catalog.js';
import { filmHeader } from './header.js';

export function mountMissing(root, films) {
  const sheet = document.createElement('main');
  sheet.className = 'a24-empty-shelf';
  sheet.innerHTML = filmHeader(null);
  const heading = document.createElement('h1');
  heading.className = 'a24-empty-name';
  heading.textContent = '404 · Empty shelf';
  const lines = document.createElement('div');
  lines.className = 'a24-shelf-lines';
  lines.setAttribute('aria-hidden', 'true');
  lines.append(...Array.from({ length: 5 }, () => document.createElement('i')));
  const disc = document.createElement('a');
  disc.className = 'a24-shelf-disc a24-disc-thumbnail';
  disc.href = filmsURL().href;
  disc.setAttribute('aria-label', '找不到這部作品，返回 Films');
  const entry = films[Math.floor(Math.random() * films.length)];
  const art = document.createElement('img');
  art.src = entry.discPrint; art.alt = '';
  disc.append(art);
  sheet.append(heading, lines, disc);
  root.after(sheet);
  return { destroy() { sheet.remove(); } };
}
