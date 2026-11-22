// The Gallery shares its current image selection with the site's project directory.
export function createDirectory(dialog, projects, openItem) {
  const scopes = dialog.querySelector('#index-scopes');
  const images = dialog.querySelector('#index-images');
  const list = dialog.querySelector('#index-list');
  const note = dialog.querySelector('.index-note');
  const modes = [...scopes.querySelectorAll('button')];
  let returnPoint = null;

  function renderImages(entries) {
    const cards = entries.map((entry, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'index-image';
      button.dataset.directoryKey = entry.key;
      const title = entry.item.labelZh || entry.item.label || entry.project.title;
      const project = entry.project.titleZh || entry.project.title;
      const number = String(index + 1).padStart(2,'0');
      button.setAttribute('aria-label', [number, title, project !== title && project].filter(Boolean).join(' · '));
      const img = document.createElement('img');
      img.alt = '';
      img.src = entry.item.small || entry.item.image;
      img.loading = 'lazy';
      const caption = document.createElement('span');
      caption.className = 'index-image-caption';
      const position = document.createElement('small');
      position.className = 'index-image-number';
      position.textContent = number;
      const name = document.createElement('span');
      name.className = 'index-image-name';
      name.textContent = title;
      caption.append(position, name);
      if (title !== project) {
        const series = document.createElement('small');
        series.className = 'index-image-project';
        series.textContent = project;
        caption.append(series);
      }
      button.append(img, caption);
      button.addEventListener('click', () => openItem(entry.projectId,entry.index,button));
      return button;
    });
    images.replaceChildren(...cards);
  }

  function select(scope) {
    images.hidden = scope !== 'images';
    list.hidden = !images.hidden;
    note.hidden = !images.hidden;
    for (const button of modes) button.setAttribute('aria-pressed',String(button.dataset.indexScope === scope));
  }

  for (const mode of modes) {
    mode.addEventListener('click', () => {
      const scope = mode.dataset.indexScope;
      const hash = scope === 'projects' ? '#helix/index/projects' : '#helix/index';
      history.replaceState(history.state,'',hash);
      select(scope);
      dialog.scrollTop = 0;
    });
  }

  return {
    remember(trigger) {
      returnPoint = {hash:location.hash, trigger, key:trigger?.dataset.directoryKey, scroll:dialog.scrollTop};
    },
    clear() { returnPoint = null; },
    show(entries, requestedScope) {
      // showModal moves focus synchronously; capture the intended return card first.
      const saved = returnPoint?.hash === location.hash ? returnPoint : null;
      returnPoint = null;
      const hasImages = Array.isArray(entries);
      scopes.hidden = !hasImages;
      modes[0].querySelector('span').textContent = hasImages ? String(entries.length) : '';
      modes[1].querySelector('span').textContent = String(projects.length);
      renderImages(entries || []);
      select(hasImages && requestedScope !== 'projects' ? 'images' : 'projects');
      if (!dialog.open) dialog.showModal();
      const focused = saved?.trigger?.isConnected ? saved.trigger :
        [...images.children].find(el => el.dataset.directoryKey === saved?.key);
      dialog.scrollTop = saved?.scroll || 0;
      (focused || dialog.querySelector('#close-index')).focus({preventScroll:true});
    }
  };
}
