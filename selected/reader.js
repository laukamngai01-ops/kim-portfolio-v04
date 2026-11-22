// Media, captions and navigation shared by the original V04 reader and Cinema.
export function bindPortfolioReader(reader, { projects, onSelect, canSelect = () => true }) {
  const $ = selector => reader.querySelector(selector);
  const stage = $('#reader-stage');
  let activeProject = null;
  let activeIndex = 0;
  function text(selector, value) { $(selector).textContent = value || ''; }
  function mediaPause() { stage.querySelector('video')?.pause(); }

  function renderMedia() {
    const previous = $('#previous');
    const next = $('#next');
    const previousFocus = document.activeElement;
    mediaPause(); stage.replaceChildren();
    const item = activeProject.items[activeIndex];
    stage.style.setProperty('--media-ratio', String((item.width || item.imageWidth || 3) / (item.height || item.imageHeight || 2)));
    const media = document.createElement(item.type === 'video' ? 'video' : 'img');
    if (item.type === 'video') {
      // Set both before assigning src. No automatic playback or audio opt-in.
      media.defaultMuted = true; media.muted = true; media.playsInline = true;
      media.controls = true; media.preload = 'metadata'; media.poster = item.image;
      media.setAttribute('aria-label', `${item.labelZh}，預設靜音`);
      media.src = item.src;
    } else {
      media.alt = `${item.labelZh} / ${item.label}`;
      media.src = item.image; media.width = item.imageWidth || item.width; media.height = item.imageHeight || item.height;
    }
    media.addEventListener('error', () => {
      if (stage.firstElementChild !== media) return;
      mediaPause();
      const box = document.createElement('div'); box.className = 'reader-error';
      const note = document.createElement('p'); note.textContent = '這件媒體暫時無法載入。';
      const retry = document.createElement('button'); retry.textContent = '重新載入';
      if (document.body.hasAttribute('data-glass')) retry.classList.add('glass-action');
      retry.addEventListener('click', renderMedia); box.append(note, retry); stage.replaceChildren(box);
    }, { once: true });
    stage.append(media);
    text('#media-label', `${String(activeIndex + 1).padStart(2, '0')} / ${String(activeProject.items.length).padStart(2, '0')} — ${item.labelZh}${item.type === 'video' ? ' · 預設靜音' : ''}`);
    previous.disabled = activeIndex === 0;
    next.disabled = activeIndex === activeProject.items.length - 1;
    if (previousFocus === next && next.disabled && !previous.disabled) previous.focus({ preventScroll: true });
    if (previousFocus === previous && previous.disabled && !next.disabled) next.focus({ preventScroll: true });
    $('#reader-source').hidden = item.type === 'video';
    $('#reader-source').href = item.image;
    const strip = $('#reader-thumbnails');
    const thumbnails = strip.querySelectorAll('button');
    thumbnails.forEach((button, index) => button.setAttribute('aria-current', String(index === activeIndex)));
    const selected = thumbnails[activeIndex];
    // Move only the horizontal strip. The reader's vertical reading position is independent.
    requestAnimationFrame(() => {
      if (!reader.open || !selected?.isConnected || selected.getAttribute('aria-current') !== 'true') return;
      const target = selected.getBoundingClientRect();
      const frame = strip.getBoundingClientRect();
      if (target.right > frame.right) strip.scrollLeft += target.right - frame.right + 2;
      else if (target.left < frame.left) strip.scrollLeft -= frame.left - target.left + 2;
    });
  }

  function selectMedia(index) {
    if (!activeProject || !canSelect()) return;
    const nextIndex = Math.max(0, Math.min(activeProject.items.length - 1, index));
    if (nextIndex === activeIndex) return;
    activeIndex = nextIndex;
    onSelect(activeProject, activeIndex);
    renderMedia();
  }

  function renderProject(project, index) {
    activeProject = project;
    activeIndex = Math.max(0, Math.min(project.items.length - 1, Math.trunc(Number(index) || 0)));
    text('#reader-category', project.category);
    text('#reader-number', `SELECTED WORK ${String(projects.indexOf(project) + 1).padStart(2, '0')}`);
    text('#reader-title', project.title); text('#reader-title-zh', project.titleZh);
    text('#reader-role-en', project.role); text('#reader-role-zh', project.roleZh);
    text('#reader-intro-en', project.intro); text('#reader-intro-zh', project.introZh);
    text('#reader-disclosure', project.disclosure); $('#reader-disclosure').hidden = !project.disclosure;
    $('.reader-copy details').open = false;
    $('#reader-thumbnails').replaceChildren();
    project.items.forEach((item, index) => {
      const button = document.createElement('button');
      button.setAttribute('aria-label', `媒體 ${index + 1}，${item.labelZh}`);
      const image = document.createElement('img'); image.src = item.small; image.alt = ''; image.loading = 'lazy';
      button.append(image);
      if (item.type === 'video') { const tag = document.createElement('span'); tag.textContent = 'FILM'; button.append(tag); }
      button.addEventListener('click', () => selectMedia(index));
      $('#reader-thumbnails').append(button);
    });
    renderMedia();
  }

  reader.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('video,input,select,textarea')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); selectMedia(activeIndex + (event.key === 'ArrowRight' ? 1 : -1)); }
  });
  $('#previous').addEventListener('click', () => selectMedia(activeIndex - 1));
  $('#next').addEventListener('click', () => selectMedia(activeIndex + 1));

  return {
    show: renderProject,
    pause: mediaPause,
    get project() { return activeProject; },
    get index() { return activeIndex; },
    clear() { mediaPause(); stage.replaceChildren(); activeProject = null; },
  };
}
