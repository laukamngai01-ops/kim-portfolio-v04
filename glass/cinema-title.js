// Independently implemented after observing the A24 tribute's whole-title mask.
// No reference runtime, fonts or media are used. Both browse directions reveal
// upward, as on the reference; the latest selection always wins an interruption.
export function createCinemaTitle({ heading, title, titleZh, disclosure, entries, canAnimate }) {
  const abort = new AbortController();
  const animations = new Set();
  const subtitle = titleZh.parentElement;
  const subtitleMotion = document.createElement('div');
  subtitleMotion.className = 'discs-subtitle-motion';
  subtitleMotion.append(...subtitle.childNodes);
  subtitle.append(subtitleMotion);
  const rule = document.createElement('span');
  rule.className = 'discs-title-rule';
  rule.setAttribute('aria-hidden', 'true');
  title.after(rule);
  const measure = document.createElement('span');
  measure.className = 'discs-title-measure';
  measure.setAttribute('aria-hidden', 'true');
  title.append(measure);
  let entry = null;
  let revision = 0;
  let disposed = false;
  let lastMeasure = '';

  function size() {
    if (disposed || !title.isConnected || title.clientWidth < 1) return;
    const style = getComputedStyle(title);
    const signature = `${title.clientWidth}/${style.font}/${style.letterSpacing}/${entry?.key}`;
    if (signature === lastMeasure) return;
    lastMeasure = signature;
    let height = 0;
    for (const item of entries) {
      measure.textContent = item.name;
      height = Math.max(height, measure.getBoundingClientRect().height);
    }
    measure.textContent = entry?.name || entries[0]?.name || '';
    const currentHeight = measure.getBoundingClientRect().height;
    measure.textContent = '';
    title.style.height = `${Math.ceil(currentHeight)}px`;
    // The rule follows the real title immediately. Reserve any spare line
    // below the entire heading instead, so the disc stage remains fixed.
    const ruleStyle = getComputedStyle(rule);
    const trim = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      + rule.offsetHeight + parseFloat(ruleStyle.marginTop) + parseFloat(ruleStyle.marginBottom)
      + subtitle.offsetHeight;
    heading.style.minHeight = `${Math.ceil(height + trim)}px`;
  }
  const observer = new ResizeObserver(size);
  observer.observe(title);
  window.addEventListener('resize', size, { signal: abort.signal });
  document.fonts?.ready.then(() => { if (!disposed) { lastMeasure = ''; size(); } });

  function stop() {
    for (const animation of animations) animation.cancel();
    animations.clear();
  }
  function animate(element, frames, options) {
    const animation = element.animate(frames, { fill: 'both', ...options });
    animations.add(animation);
    animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
    return animation;
  }
  function face(item) {
    const node = document.createElement('span');
    node.className = 'discs-title-face';
    node.dataset.key = item.key;
    node.setAttribute('aria-hidden', 'true');
    node.textContent = item.name;
    title.append(node);
    return node;
  }
  function details(item) {
    titleZh.textContent = item.nameZh;
    disclosure.textContent = item.isAI ? 'AI 輔助' : '';
    disclosure.hidden = !item.isAI;
  }
  function finish() {
    revision++;
    stop();
    title.querySelectorAll('.discs-title-face').forEach(node => node.remove());
    if (entry) { face(entry); details(entry); }
    subtitleMotion.style.transform = '';
    rule.style.transform = '';
    heading.dataset.titleState = 'idle';
  }
  function render(next, { immediate = false } = {}) {
    if (disposed || entry?.key === next.key) return;
    const previous = entry;
    entry = next;
    const token = ++revision;
    heading.dataset.titleKey = next.key;
    heading.dataset.titleDirection = previous && entries.indexOf(next) < entries.indexOf(previous) ? 'previous' : 'next';
    title.setAttribute('aria-label', next.name);
    size();
    if (!previous || immediate || !canAnimate() || !title.animate) { finish(); return; }

    // Keep the most visible real layer if a browse input interrupts the reveal.
    // Reading computed transforms before cancelling preserves its painted pose.
    const layers = [...title.querySelectorAll('.discs-title-face')].map(node => {
      const transform = getComputedStyle(node).transform;
      const y = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
      return { node, transform, distance: Math.abs(y) };
    }).sort((a, b) => a.distance - b.distance);
    stop();
    const outgoing = layers[0];
    layers.slice(1).forEach(({ node }) => node.remove());
    if (outgoing) outgoing.node.style.transform = outgoing.transform;
    heading.dataset.titleState = 'revealing';
    details(next);
    const incoming = outgoing?.node.dataset.key === next.key ? outgoing.node : face(next);
    const from = incoming === outgoing?.node ? outgoing.transform : 'translateY(120%)';
    if (outgoing && outgoing.node !== incoming) {
      const leave = animate(outgoing.node,
        [{ transform: outgoing.transform }, { transform: 'translateY(-120%)' }],
        { duration: 190, easing: 'cubic-bezier(.4,0,.2,1)' });
      leave.finished.then(() => { if (token === revision) outgoing.node.remove(); }, () => {});
    }
    const arrive = animate(incoming,
      [{ transform: from }, { transform: 'translateY(0)' }],
      { duration: 480, delay: incoming === outgoing?.node ? 0 : 115, easing: 'cubic-bezier(.16,1,.3,1)' });
    animate(subtitleMotion,
      [{ transform: 'translateY(120%)' }, { transform: 'translateY(0)' }],
      { duration: 410, delay: 165, easing: 'cubic-bezier(.16,1,.3,1)' });
    animate(rule, [{ transform: 'scaleX(.08)' }, { transform: 'scaleX(1)' }],
      { duration: 390, delay: 90, easing: 'cubic-bezier(.22,1,.36,1)' });
    arrive.finished.then(() => {
      if (disposed || token !== revision) return;
      title.querySelectorAll('.discs-title-face').forEach(node => { if (node !== incoming) node.remove(); });
      incoming.style.transform = '';
      heading.dataset.titleState = 'idle';
      // Remove finished fill effects as well as references to detached layers.
      for (const node of [incoming, subtitleMotion, rule]) node.getAnimations().forEach(animation => animation.cancel());
    }, () => {});
  }
  return {
    render, finish,
    dispose() { disposed = true; revision++; stop(); observer.disconnect(); abort.abort(); },
  };
}
