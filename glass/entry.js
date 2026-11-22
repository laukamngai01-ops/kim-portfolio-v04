import { films, filmURL, filmsURL } from '../a24/catalog.js';
import { projects } from '../selected/data.js';

const archival = new URL(location.href).searchParams.get('edition') === 'vinyl';

function migrateBookmark(event) {
  const [scene, section, projectId, rawIndex] = location.hash.slice(1).split('/');
  if (archival || scene === 'helix') return false;

  // The sphere's Index contained all six projects, including photography and design.
  if (scene === 'sphere' && section === 'index') {
    history.replaceState(history.state, '', '#helix/index/projects');
    return false;
  }

  let target = filmsURL();
  if ((scene === 'sphere' || scene === 'discs') && section === 'project') {
    const project = projects.find(project => project.id === projectId);
    if (project) {
      const index = Math.max(0, Math.min(project.items.length - 1, Math.trunc(Number(rawIndex) || 0)));
      const film = films.find(film => film.projectId === project.id && film.index === index);
      if (!film) {
        history.replaceState(history.state, '', `#helix/project/${project.id}/${index}`);
        return false;
      }
      target = filmURL(film);
    }
  }
  // A hash edit in an already mounted Gallery must not also start the old scene.
  event?.stopImmediatePropagation();
  location.replace(target.href);
  return true;
}

if (!migrateBookmark()) {
  if (archival) {
    const header = document.querySelector('#vinyl-masthead').content.firstElementChild;
    const tools = document.querySelector('.gallery-tools');
    header.append(...tools.children);
    document.querySelector('.portfolio-masthead').replaceWith(header);
    tools.remove();
  }
  document.documentElement.hidden = false;
  window.addEventListener('hashchange', migrateBookmark);
  await import('./controls.js');
  await import('../selected/app.js');
}
