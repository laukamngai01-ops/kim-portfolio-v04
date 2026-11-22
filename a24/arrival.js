// A loading status, not a second title sequence. Counts come from real assets.
export function startArrival(root) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const layer = document.createElement('div');
  layer.className = 'a24-arrival';
  layer.setAttribute('role', 'status');
  layer.setAttribute('aria-live', 'polite');
  layer.setAttribute('aria-atomic', 'true');
  const label = document.createElement('span');
  label.className = 'a24-arrival-label';
  label.textContent = '載入作品';
  const count = document.createElement('span');
  count.className = 'a24-arrival-count';
  const track = document.createElement('span');
  track.className = 'a24-arrival-track';
  track.setAttribute('aria-hidden', 'true');
  track.append(document.createElement('i'));
  layer.append(label, count, track);
  root.append(layer);
  root.dataset.arriving = 'true';

  let complete = false, shown = false, fade;
  // Warm loads do not flash a loader; slow loads get one stable, readable line.
  const reveal = setTimeout(() => {
    if (complete) return;
    shown = true;
    layer.classList.add('is-visible');
  }, 160);
  const slow = setTimeout(() => {
    if (!complete) label.textContent = '仍在載入作品';
  }, 8000);

  function finish(immediate = false) {
    if (complete) {
      if (immediate) { fade?.cancel(); layer.remove(); }
      return;
    }
    complete = true;
    clearTimeout(reveal);
    clearTimeout(slow);
    delete root.dataset.arriving;
    if (immediate || reduced.matches || !shown || !layer.animate) {
      layer.remove();
      return;
    }
    fade = layer.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 120, easing: 'ease-out', fill: 'forwards',
    });
    fade.finished.then(() => layer.remove(), () => layer.remove());
  }

  return {
    progress(loaded, total) {
      if (complete || !Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0) return;
      const available = Math.max(1, Math.floor(total));
      const done = Math.min(available, Math.max(0, Math.floor(loaded)));
      count.textContent = `${done} / ${available}`;
      layer.style.setProperty('--arrival-progress', String(done / available));
    },
    loaded() { finish(); },
    finish,
  };
}
