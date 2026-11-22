// Direction and timing follow measured shelf changes in both directions.
// Incoming and departing lines travel up through stationary apertures.
const measuredLift = 'linear(0, .09 11%, .58 26%, .86 41%, .94 54%, .98 71%, 1)';
const measuredRise = 'linear(0, .10 7%, .30 13%, .56 20%, .77 27%, .86 34%, .94 46%, .975 60%, .993 76%, 1)';
const supportsLinear = globalThis.CSS?.supports('animation-timing-function', measuredRise);
const lift = supportsLinear ? measuredLift : 'cubic-bezier(.35,0,.08,1)';
const rise = supportsLinear ? measuredRise : 'cubic-bezier(.37,0,.04,1)';
const offset = distance => `translateY(${distance}%)`;

function splitLines(face) {
  if (face.children.length || !face.offsetWidth) return;
  const content = face.firstChild;
  if (!content || content.nodeType !== Node.TEXT_NODE) return;
  // Read the browser's balanced, actually wrapped lines in the active font.
  const range = document.createRange();
  const starts = [0];
  let top;
  for (const word of content.data.matchAll(/\S+/gu)) {
    range.setStart(content, word.index);
    range.setEnd(content, word.index + word[0].length);
    const rect = range.getBoundingClientRect();
    if (top !== undefined && Math.abs(rect.top - top) > 1) starts.push(word.index);
    top = rect.top;
  }
  const text = content.data;
  face.classList.add('a24-split-face');
  face.replaceChildren(...starts.map((start, i) => {
    const mask = document.createElement('span'), ink = document.createElement('span');
    mask.className = 'a24-line-mask'; ink.className = 'a24-line-ink';
    ink.style.setProperty('--a24-line', i);
    ink.textContent = text.slice(start, starts[i + 1]);
    mask.append(ink);
    return mask;
  }));
}

const inkOf = face => face.children.length ? [...face.querySelectorAll('.a24-line-ink')] : [face];
function visibleParts(face) {
  return inkOf(face).map(ink => {
    const transform = getComputedStyle(ink).transform;
    const y = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
    const fraction = Math.min(1, Math.abs(y) / (ink.offsetHeight || 1));
    return { ink, transform, visible: 1 - fraction };
  });
}

export function createShelfTypeMotion(root) {
  const active = new Set();
  let reflowAfterMotion = false;
  function play(node, keyframes, options) {
    const animation = node.animate(keyframes, { fill: 'both', ...options });
    active.add(animation);
    animation.finished.then(() => {
      active.delete(animation);
      if (!active.size && reflowAfterMotion) reflow();
      // An outgoing line must stay outside its aperture while later lines finish.
      if (node.closest('.a24-mask-outgoing')) return;
      animation.cancel();
    }, () => active.delete(animation));
    return animation.finished;
  }
  function replace(mask, text, mode, outAt = 0, inAt = 0) {
    const animate = mode !== 'static';
    const first = mode === 'arrival';
    const isCaption = mask.classList.contains('a24-note-text');
    mask.setAttribute('aria-label', text);
    const old = [...mask.children];
    if (isCaption && animate) old.forEach(splitLines);
    const visible = animate ? old.map(face => ({ face, parts: visibleParts(face) }))
      .sort((a, b) => Math.max(...b.parts.map(p => p.visible)) - Math.max(...a.parts.map(p => p.visible)))[0] : null;
    for (const face of old) {
      if (face === visible?.face && visible.parts.some(p => p.visible > .01)) {
        // A second input during departure keeps the original trajectory.
        if (face.classList.contains('a24-mask-outgoing')) continue;
        face.classList.add('a24-mask-outgoing');
        face.setAttribute('aria-hidden', 'true');
        const completions = visible.parts.map(({ ink, transform, visible: amount }, line) => {
          ink.getAnimations().forEach(animation => animation.cancel());
          if (amount <= .01) { ink.style.visibility = 'hidden'; return Promise.resolve(); }
          return play(ink, [{ transform }, { transform: offset(-120) }], {
            delay: outAt + line * 15, duration: 380, easing: lift,
          });
        });
        Promise.allSettled(completions).then(() => face.remove());
      } else {
        face.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
        face.remove();
      }
    }
    const face = document.createElement('span');
    face.className = 'a24-mask-face';
    face.textContent = text;
    mask.append(face);
    if (isCaption) splitLines(face);
    if (!animate) return;
    for (const [line, ink] of inkOf(face).entries()) {
      play(ink, [{ transform: offset(120) }, { transform: offset(0) }], {
        delay: (first ? (inAt - 745) * .58 : inAt) + line * (first ? 26 : 45),
        duration: first ? 550 : 720, easing: rise,
      });
    }
  }
  function rule(node, row, mode) {
    if (mode === 'static') return;
    if (mode === 'arrival') {
      play(node, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
        { duration: 550, delay: 26 + row * 58, easing: rise });
      return;
    }
    const transform = getComputedStyle(node).transform;
    const start = transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a;
    node.getAnimations().forEach(animation => animation.cancel());
    const outAt = 75 + row * 48, inAt = 790 + row * 100, total = inAt + 720;
    play(node, [
      { transform: `scaleX(${start})`, offset: 0 },
      { transform: `scaleX(${start})`, offset: outAt / total, easing: lift },
      { transform: 'scaleX(0)', offset: (outAt + 380) / total },
      { transform: 'scaleX(0)', offset: inAt / total, easing: rise },
      { transform: 'scaleX(1)', offset: 1 },
    ], { duration: total });
  }
  function reflow() {
    reflowAfterMotion = active.size > 0;
    if (reflowAfterMotion) return;
    root.querySelectorAll('.a24-note-text .a24-mask-face').forEach(face => {
      // Reflow at the current width/font, including the one-line captions.
      face.classList.remove('a24-split-face');
      face.textContent = face.textContent;
      splitLines(face);
    });
  }
  function settle() {
    for (const animation of active) animation.cancel();
    active.clear();
    root.querySelectorAll('.a24-mask-outgoing').forEach(node => node.remove());
    reflow();
  }
  return { replace, rule, reflow, settle };
}
